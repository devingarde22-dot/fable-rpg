import { DeterministicRng } from "../rng/DeterministicRng.js";
import { cellIndex } from "../grid/Grid.js";
import { applyDamage } from "../combat/damage.js";
import type {
  ActiveIntent,
  EnemyRuntime,
  EntityRuntime,
  IntentTemplate,
  RngForkInput,
  RuntimeState,
} from "../engine/types.js";
import { ACTIVE_INTENT_HANDLERS } from "./registry.js";
import { eventBase, type EventDefinition, type PendingDomainEvent, type PendingJournalEvent } from "./events.js";
import { nextGreedyPathCell } from "./geometry.js";
import { selectIntentTarget } from "./targeting.js";
import { isIntentStillValid, validateIntent } from "./validation.js";
import { applyAllyGuard, applyImmobilized } from "../statuses/statusSystem.js";

export function activateScene(state: RuntimeState): PendingJournalEvent[] {
  if (state.phase !== "loading") throw new Error("Scene can only activate from loading");
  state.phase = "active";
  const pending: PendingJournalEvent[] = [];
  const initialIntents = new Map(state.initialIntentByEnemyId);
  for (const enemy of [...state.entities.values()].filter((entity): entity is EnemyRuntime => entity.kind === "enemy" && entity.aliveState === "active")) {
    if (enemy.templateKey === "extinguisher" && !initialIntents.has(enemy.id)) {
      const enemyTemplate = state.enemyTemplates.get(enemy.templateKey);
      const priority = ["bind", "ally_guard", "move_close", "hold_position"];
      const selected = priority.find((key) => {
        if (!enemyTemplate?.intentKeys.includes(key)) return false;
        const candidate = state.intentTemplates.get(key);
        return Boolean(candidate && candidate.status === "confirmed" && ACTIVE_INTENT_HANDLERS.has(candidate.effect.handler) &&
          validateIntent(state, enemy, candidate, makeActiveIntentId(state, enemy.id, key, state.serverTick), null).ok);
      });
      if (selected) initialIntents.set(enemy.id, selected);
    }
  }
  const orderedInitialIntents = [...initialIntents.entries()].sort(([a], [b]) => compareText(a, b));
  for (const [enemyId, templateKey] of orderedInitialIntents) {
    const enemy = state.entities.get(enemyId);
    const template = state.intentTemplates.get(templateKey);
    const enemyTemplate = enemy?.kind === "enemy" ? state.enemyTemplates.get(enemy.templateKey) : undefined;
    if (!enemy || enemy.kind !== "enemy" || !template || !enemyTemplate?.intentKeys.includes(templateKey) ||
      template.status !== "confirmed" || !ACTIVE_INTENT_HANDLERS.has(template.effect.handler)) {
      throw new Error(`Invalid or unsupported initial intent ${templateKey} for ${enemyId}`);
    }
    pending.push(...startIntent(state, enemy, template, state.serverTick, null));
  }
  return pending;
}

export function resolveDueIntents(state: RuntimeState, serverTick: number): PendingJournalEvent[] {
  const due = [...state.activeIntents.values()]
    .filter((intent) => intent.resolvesAtTick <= serverTick)
    .sort((a, b) => compareText(a.ownerEntityId, b.ownerEntityId));
  const pending: PendingJournalEvent[] = [];
  for (const active of due) {
    const current = state.activeIntents.get(active.activeIntentId);
    if (!current) continue;
    const enemy = state.entities.get(current.ownerEntityId);
    const template = state.intentTemplates.get(current.templateKey);
    if (!enemy || enemy.kind !== "enemy" || enemy.aliveState !== "active" || enemy.hp.current === 0 || !template) continue;
    current.state = "resolving";
    const validation = isIntentStillValid(state, enemy, current, template);
    if (!validation.ok) {
      pending.push(...cancelAndFallback(state, enemy, current, template, validation.reason, serverTick));
      continue;
    }

    const target = validation.target;
    const resolved = makeEvent(state, serverTick, enemy.id, {
      eventType: "intent.resolved",
      payload: {
        enemyId: enemy.id,
        activeIntentId: current.activeIntentId,
        effectKey: template.effect.handler,
        ...(target ? { targetEntityId: target.id } : {}),
      },
      replay: current.seedRef ? { seedRef: current.seedRef } : null,
    });
    pending.push({ event: resolved });
    applyEffect(state, enemy, target, current.activeIntentId, template, pending, serverTick);
    clearActiveIntent(state, enemy, current);
    pending.push(...startNextIntent(state, enemy, target?.id ?? current.targetEntityId, serverTick));
  }
  return pending;
}

export function startIntent(
  state: RuntimeState,
  enemy: EnemyRuntime,
  template: IntentTemplate,
  serverTick: number,
  preferredTargetId: string | null,
): PendingJournalEvent[] {
  if (enemy.aliveState !== "active" || enemy.hp.current === 0 || !ACTIVE_INTENT_HANDLERS.has(template.effect.handler)) return [];
  const activeIntentId = makeActiveIntentId(state, enemy.id, template.key, serverTick);
  const usesTargetSelection = template.targetRules.policy !== "none" || template.targetRules.fallbackPolicies.length > 0;
  const forkInput: RngForkInput = {
    rootSeed: state.rootSeed,
    campaignId: state.campaignId,
    sceneId: state.scene.id,
    serverTick,
    activeIntentId,
    purpose: "target_selection",
  };
  const rng = usesTargetSelection ? DeterministicRng.fork(forkInput) : null;
  const rngBefore = rng?.state();
  const selected = template.effect.handler === "hold_position"
    ? null
    : selectIntentTarget(state, enemy, template, activeIntentId, preferredTargetId, rng ?? undefined);
  const audit = rng && rngBefore ? rng.auditRecord(forkInput, rngBefore) : null;
  const durationTicks = template.durationMs / 50;
  const active: ActiveIntent = {
    activeIntentId,
    ownerEntityId: enemy.id,
    templateKey: template.key,
    state: "telegraphed",
    startedAtTick: serverTick,
    resolvesAtTick: serverTick + durationTicks,
    targetEntityId: selected?.target.id ?? null,
    targetCell: selected ? { ...selected.targetCell } : null,
    publicTargetCell: selected && template.visibility === "public" ? { ...selected.targetCell } : null,
    selectionPolicy: selected?.policy ?? template.targetRules.policy,
    seedRef: rng?.seedRef ?? null,
    cancelReason: null,
  };
  state.activeIntents.set(activeIntentId, active);
  enemy.activeIntentId = activeIntentId;

  const started = makeEvent(state, serverTick, enemy.id, {
    eventType: "intent.started",
    payload: {
      enemyId: enemy.id,
      templateKey: template.key,
      activeIntentId,
      timer: {
        startedAtTick: serverTick,
        resolvesAtTick: active.resolvesAtTick,
        durationMs: template.durationMs,
        remainingMs: template.durationMs,
        paused: false,
      },
      icon: template.icon,
      ...(active.publicTargetCell ? { publicTargetCell: { ...active.publicTargetCell } } : {}),
    },
    replay: active.seedRef ? { seedRef: active.seedRef } : null,
  });
  const pending: PendingJournalEvent[] = [{ event: started }];
  if (selected) {
    if (!rng || !active.seedRef) throw new Error("Target selection requires a deterministic RNG fork");
    const targetSelected = makeEvent(state, serverTick, enemy.id, {
      eventType: "intent.target_selected",
      payload: {
        activeIntentId,
        enemyId: enemy.id,
        targetEntityId: selected.target.id,
        targetCell: { ...selected.targetCell },
        selectionPolicy: selected.policy,
        tieBreak: selected.tieBreak,
        seedRef: rng.seedRef,
      },
      replay: active.seedRef ? { seedRef: active.seedRef } : null,
    });
    pending.push({ event: targetSelected, rngAudit: audit ? [audit] : [] });
  } else {
    pending[0] = { event: started, rngAudit: audit ? [audit] : [] };
  }
  return pending;
}

function cancelAndFallback(
  state: RuntimeState,
  enemy: EnemyRuntime,
  active: ActiveIntent,
  template: IntentTemplate,
  failureReason: "target_invalid" | "path_blocked" | "los_blocked" | "no_longer_possible",
  serverTick: number,
): PendingJournalEvent[] {
  clearActiveIntent(state, enemy, active);
  const forkInput: RngForkInput = {
    rootSeed: state.rootSeed,
    campaignId: state.campaignId,
    sceneId: state.scene.id,
    serverTick,
    activeIntentId: active.activeIntentId,
    purpose: "fallback_selection",
  };
  const rng = DeterministicRng.fork(forkInput);
  const before = rng.state();
  const audit = rng.auditRecord(forkInput, before);
  const cancelReason = failureReason;
  const cancellationEvent = makeEvent(state, serverTick, enemy.id, {
    eventType: "intent.cancelled",
    payload: { enemyId: enemy.id, activeIntentId: active.activeIntentId, reason: cancelReason },
    replay: { seedRef: rng.seedRef },
  });
  const pending: PendingJournalEvent[] = [{ event: cancellationEvent, rngAudit: [audit] }];
  const enemyTemplate = state.enemyTemplates.get(enemy.templateKey);
  const attemptedTemplateKeys = new Set<string>([template.key]);
  const fallbackKeys = [...template.fallbackKeys, "hold_position"];
  for (const fallbackKey of fallbackKeys) {
    if (attemptedTemplateKeys.has(fallbackKey)) continue;
    attemptedTemplateKeys.add(fallbackKey);
    if (enemyTemplate && !enemyTemplate.intentKeys.includes(fallbackKey)) continue;
    const candidate = state.intentTemplates.get(fallbackKey);
    if (!candidate || candidate.status !== "confirmed" || !ACTIVE_INTENT_HANDLERS.has(candidate.effect.handler)) continue;
    const candidateId = makeActiveIntentId(state, enemy.id, candidate.key, serverTick);
    const validation = validateIntent(state, enemy, candidate, candidateId, active.targetEntityId);
    if (!validation.ok) continue;
    pending.push(...startIntent(state, enemy, candidate, serverTick, active.targetEntityId));
    return pending;
  }
  const noFallbackEvent = makeEvent(state, serverTick, enemy.id, {
    eventType: "intent.cancelled",
    payload: { enemyId: enemy.id, activeIntentId: active.activeIntentId, reason: "no_valid_fallback" },
    replay: { seedRef: rng.seedRef },
  });
  // Replace the first cancellation with the canonical terminal reason when no fallback is possible.
  pending[0] = { event: noFallbackEvent, rngAudit: [audit] };
  return pending;
}

function startNextIntent(
  state: RuntimeState,
  enemy: EnemyRuntime,
  preferredTargetId: string | null,
  serverTick: number,
): PendingJournalEvent[] {
  if (enemy.aliveState !== "active" || enemy.hp.current === 0) return [];
  const enemyTemplate = state.enemyTemplates.get(enemy.templateKey);
  if (!enemyTemplate) return [];
  for (const intentKey of enemyTemplate.intentKeys) {
    const template = state.intentTemplates.get(intentKey);
    if (!template || template.status !== "confirmed" || !ACTIVE_INTENT_HANDLERS.has(template.effect.handler)) continue;
    const candidateId = makeActiveIntentId(state, enemy.id, template.key, serverTick);
    if (!validateIntent(state, enemy, template, candidateId, preferredTargetId).ok) continue;
    return startIntent(state, enemy, template, serverTick, preferredTargetId);
  }
  return [];
}

function applyEffect(
  state: RuntimeState,
  enemy: EnemyRuntime,
  target: EntityRuntime | null,
  activeIntentId: string,
  template: IntentTemplate,
  pending: PendingJournalEvent[],
  serverTick: number,
): void {
  switch (template.effect.handler) {
    case "move_close": {
      if (!target) return;
      const from = { ...enemy.position };
      let destination = { ...enemy.position };
      for (let step = 0; step < 2; step += 1) {
        const next = nextGreedyPathCell(state.scene.cells, enemy, target);
        if (!next) break;
        const fromCell = state.scene.cells[cellIndex(enemy.position)];
        const toCell = state.scene.cells[cellIndex(next)];
        if (!fromCell || !toCell || fromCell.occupantId !== enemy.id || toCell.occupantId !== null) break;
        fromCell.occupantId = null;
        toCell.occupantId = enemy.id;
        enemy.position = { ...next };
        destination = { ...next };
      }
      if (from.x !== destination.x || from.y !== destination.y) {
        pending.push({
          event: makeEvent(state, serverTick, enemy.id, {
            eventType: "scene.entity_moved",
            payload: { entityId: enemy.id, from, to: destination },
            replay: null,
          }),
        });
      }
      return;
    }
    case "melee_strike":
    case "ranged_shot": {
      if (!target) return;
      const rawDamage = template.effect.parameters.rawDamage;
      const result = applyDamage(state, {
        target,
        source: { kind: "enemy_intent", enemyId: enemy.id, activeIntentId, handler: template.effect.handler },
        rawDamage,
        multiplier: 1,
        serverTick,
        causedByRequestId: null,
      });
      pending.push(...result.protectionEvents);
      if (result.event) pending.push(result.event);
      return;
    }
    case "hold_position":
      return;
    case "bind": {
      if (!target) throw new Error(`Bind intent ${activeIntentId} resolved without a target`);
      pending.push(applyImmobilized(state, target, enemy, activeIntentId, serverTick));
      return;
    }
    case "ally_guard": {
      if (!target || target.kind !== "enemy") throw new Error(`Ally Guard intent ${activeIntentId} resolved without an eligible ally`);
      pending.push(applyAllyGuard(
        state,
        target,
        enemy,
        activeIntentId,
        serverTick,
        template.effect.parameters.defenseBonusPercent,
        template.effect.parameters.durationMs,
      ));
      return;
    }
    case "reposition":
      return;
  }
}

function clearActiveIntent(state: RuntimeState, enemy: EnemyRuntime, active: ActiveIntent): void {
  active.state = "cancelled";
  state.activeIntents.delete(active.activeIntentId);
  enemy.activeIntentId = null;
}

function makeEvent(
  state: RuntimeState,
  serverTick: number,
  actorId: string,
  event: EventDefinition,
): PendingDomainEvent {
  return { ...eventBase(state, serverTick, actorId, null), ...event } as PendingDomainEvent;
}

function makeActiveIntentId(state: RuntimeState, enemyId: string, templateKey: string, tick: number): string {
  return `${state.scene.id}:${enemyId}:${tick}:${templateKey}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
