import { cloneRuntimeState, snapshotState } from "../engine/createRuntimeState.js";
import { assertRuntimeInvariants } from "../engine/invariants.js";
import { cellIndex, isInBounds } from "../grid/Grid.js";
import { checkMovementDestination } from "../grid/collision.js";
import { calculateDamage } from "../combat/damage.js";
import {
  DAMAGE_FORMULA_VERSION,
  type DomainEvent,
  type JournalRecord,
  type RuntimeSnapshot,
  type RuntimeState,
  type RngAuditRecord,
} from "../engine/types.js";
import { cloneEvent } from "../journal/EventJournal.js";
import { modeFromEvent } from "../combat/heroModes.js";

export function replayEvents(initialState: RuntimeState, events: readonly DomainEvent[]): RuntimeSnapshot {
  const state = cloneRuntimeState(initialState);
  state.phase = "active";
  const progress = createReplayProgress(state);
  for (const sourceEvent of events) applyReplayEvent(state, cloneEvent(sourceEvent), progress);
  return snapshotState(state);
}

export function replayJournalRecords(initialState: RuntimeState, records: readonly JournalRecord[]): RuntimeSnapshot {
  const state = cloneRuntimeState(initialState);
  state.phase = "active";
  const progress = createReplayProgress(state);
  let lastTickMark: number | null = null;

  for (const record of records) {
    if (record.kind === "event") {
      validateRngAudit(record.event, record.rngAudit);
      applyReplayEvent(state, cloneEvent(record.event), progress);
      continue;
    }
    if (record.kind === "input_window") {
      if (record.serverTick !== state.serverTick) throw new Error("Replay input-window record has the wrong serverTick");
      state.scene.inputWindow = cloneInputWindow(record.inputWindow);
      continue;
    }
    if (lastTickMark === null) {
      if (record.serverTick !== state.serverTick) throw new Error("Replay first tick mark does not match initial serverTick");
    } else if (record.serverTick !== lastTickMark + 1) {
      throw new Error("Replay tick marks are not consecutive");
    }
    const stateTickIsExpected = record.serverTick === state.serverTick ||
      (lastTickMark !== null && state.serverTick === lastTickMark);
    if (!stateTickIsExpected || record.sceneRevision !== state.sceneRevision) {
      throw new Error("Replay tick mark does not match event-derived runtime state");
    }
    state.scene.inputWindow = cloneInputWindow(record.inputWindow);
    state.serverTick = record.serverTick;
    lastTickMark = record.serverTick;
    assertRuntimeInvariants(state);
  }
  return snapshotState(state);
}

type ReplayProgress = {
  previousSequence: number;
  previousEventTick: number;
  currentGroup: string;
  expectedEventIndex: number;
  currentGroupRevision: number;
};

function createReplayProgress(state: RuntimeState): ReplayProgress {
  return {
    previousSequence: state.nextServerSequence - 1,
    previousEventTick: state.serverTick,
    currentGroup: "",
    expectedEventIndex: 0,
    currentGroupRevision: -1,
  };
}

function applyReplayEvent(state: RuntimeState, event: DomainEvent, progress: ReplayProgress): void {
  if (event.protocolVersion !== "fable.protocol.v1" || event.schemaVersion !== 1 ||
    (event.eventVersion !== 1 && !(event.eventType === "hp.changed" && event.eventVersion === 2))) {
    throw new Error("Unsupported or invalid event contract");
  }
  if (event.serverSequence !== progress.previousSequence + 1) throw new Error("Replay sequence is not consecutive");
  if (event.serverTick < progress.previousEventTick) throw new Error("Replay event tick moved backwards");
  if (event.campaignId !== state.campaignId || event.sessionId !== state.sessionId || event.sceneId !== state.scene.id) {
    throw new Error("Replay event scope does not match initial state");
  }
  if (event.eventIndex === 0) {
    if (event.sceneRevision !== state.sceneRevision + 1) throw new Error("Replay sceneRevision did not advance exactly once for the batch");
    progress.currentGroup = event.eventGroupId;
    progress.currentGroupRevision = event.sceneRevision;
    progress.expectedEventIndex = 0;
  }
  if (event.eventGroupId !== progress.currentGroup || event.sceneRevision !== progress.currentGroupRevision || event.eventIndex !== progress.expectedEventIndex) {
    throw new Error("Replay event group, revision, or eventIndex is inconsistent");
  }
  progress.expectedEventIndex += 1;

  switch (event.eventType) {
    case "scene.entity_moved":
      applyMovement(state, event);
      break;
    case "scene.entity_removed":
      applyEntityRemoved(state, event);
      break;
    case "intent.started":
      applyIntentStarted(state, event);
      break;
    case "intent.target_selected":
      applyTargetSelected(state, event);
      break;
    case "intent.cancelled":
      applyIntentCancelled(state, event);
      break;
    case "intent.resolved":
      applyIntentResolved(state, event);
      break;
    case "hp.changed":
      applyHpChanged(state, event);
      break;
    case "mode.changed":
      applyModeChanged(state, event);
      break;
  }

  state.phase = "active";
  state.serverTick = event.serverTick;
  state.scene.inputWindow = { windowId: Math.floor(event.serverTick / 5), commands: [] };
  state.sceneRevision = event.sceneRevision;
  state.nextServerSequence = event.serverSequence + 1;
  progress.previousSequence = event.serverSequence;
  progress.previousEventTick = event.serverTick;
  assertRuntimeInvariants(state);
}

function applyMovement(state: RuntimeState, event: Extract<DomainEvent, { eventType: "scene.entity_moved" }>): void {
  const entity = state.entities.get(event.payload.entityId);
  if (!entity || entity.aliveState === "removed" || !isInBounds(event.payload.from) || !isInBounds(event.payload.to)) {
    throw new Error("Replay movement references invalid entity or cell");
  }
  if (entity.position.x !== event.payload.from.x || entity.position.y !== event.payload.from.y) {
    throw new Error("Replay movement from-cell does not match current entity position");
  }
  const sourceCell = state.scene.cells[cellIndex(event.payload.from)];
  if (!sourceCell || sourceCell.occupantId !== entity.id) throw new Error("Replay source occupancy is inconsistent");
  const collision = checkMovementDestination(state.scene.cells, event.payload.to);
  if (!collision.ok) throw new Error(`Replay destination is invalid: ${collision.code}`);
  sourceCell.occupantId = null;
  const destinationCell = state.scene.cells[cellIndex(event.payload.to)];
  if (!destinationCell) throw new Error("Replay destination cell is missing");
  destinationCell.occupantId = entity.id;
  entity.position = { ...event.payload.to };
}

function applyIntentStarted(state: RuntimeState, event: Extract<DomainEvent, { eventType: "intent.started" }>): void {
  const { enemyId, activeIntentId, templateKey, timer, icon } = event.payload;
  const enemy = state.entities.get(enemyId);
  const intentTemplate = state.intentTemplates.get(templateKey);
  const enemyTemplate = enemy?.kind === "enemy" ? state.enemyTemplates.get(enemy.templateKey) : undefined;
  if (!enemy || enemy.kind !== "enemy" || enemy.aliveState !== "active" || !intentTemplate || !enemyTemplate ||
    !enemyTemplate.intentKeys.includes(templateKey) || state.activeIntents.has(activeIntentId) || enemy.activeIntentId !== null) {
    throw new Error("Replay intent.started references an invalid enemy, template, or active intent");
  }
  if (intentTemplate.status !== "confirmed" || timer.durationMs !== intentTemplate.durationMs ||
    timer.durationMs < 3_000 || timer.durationMs % 50 !== 0 ||
    timer.startedAtTick !== event.serverTick || timer.resolvesAtTick !== event.serverTick + timer.durationMs / 50 ||
    timer.remainingMs !== timer.durationMs || timer.paused !== false || icon !== intentTemplate.icon) {
    throw new Error("Replay intent.started timer/template payload is inconsistent");
  }
  const active = {
    activeIntentId,
    ownerEntityId: enemy.id,
    templateKey,
    state: "telegraphed" as const,
    startedAtTick: event.serverTick,
    resolvesAtTick: timer.resolvesAtTick,
    targetEntityId: null,
    targetCell: null,
    publicTargetCell: event.payload.publicTargetCell ? { ...event.payload.publicTargetCell } : null,
    selectionPolicy: intentTemplate.targetRules.policy,
    seedRef: event.replay?.seedRef ?? null,
    cancelReason: null,
  };
  state.activeIntents.set(activeIntentId, active);
  enemy.activeIntentId = activeIntentId;
}

function applyTargetSelected(state: RuntimeState, event: Extract<DomainEvent, { eventType: "intent.target_selected" }>): void {
  const active = state.activeIntents.get(event.payload.activeIntentId);
  const enemy = state.entities.get(event.payload.enemyId);
  const target = state.entities.get(event.payload.targetEntityId);
  if (!active || !enemy || enemy.kind !== "enemy" || !target || target.aliveState !== "active" ||
    active.ownerEntityId !== enemy.id || !isInBounds(event.payload.targetCell) ||
    target.position.x !== event.payload.targetCell.x || target.position.y !== event.payload.targetCell.y ||
    (event.replay && event.replay.seedRef !== event.payload.seedRef)) {
    throw new Error("Replay intent.target_selected payload is inconsistent");
  }
  active.targetEntityId = target.id;
  active.targetCell = { ...event.payload.targetCell };
  active.selectionPolicy = event.payload.selectionPolicy;
  active.seedRef = event.payload.seedRef;
}

function applyIntentCancelled(state: RuntimeState, event: Extract<DomainEvent, { eventType: "intent.cancelled" }>): void {
  const active = state.activeIntents.get(event.payload.activeIntentId);
  const enemy = state.entities.get(event.payload.enemyId);
  if (!active || !enemy || enemy.kind !== "enemy" || active.ownerEntityId !== enemy.id || enemy.activeIntentId !== active.activeIntentId) {
    throw new Error("Replay intent.cancelled references a missing active intent");
  }
  active.state = "cancelled";
  active.cancelReason = event.payload.reason;
  state.activeIntents.delete(active.activeIntentId);
  enemy.activeIntentId = null;
}

function applyIntentResolved(state: RuntimeState, event: Extract<DomainEvent, { eventType: "intent.resolved" }>): void {
  const active = state.activeIntents.get(event.payload.activeIntentId);
  const enemy = state.entities.get(event.payload.enemyId);
  const template = active ? state.intentTemplates.get(active.templateKey) : undefined;
  if (!active || !enemy || enemy.kind !== "enemy" || active.ownerEntityId !== enemy.id ||
    enemy.activeIntentId !== active.activeIntentId || !template || template.effect.handler !== event.payload.effectKey ||
    (event.payload.targetEntityId && active.targetEntityId !== event.payload.targetEntityId)) {
    throw new Error("Replay intent.resolved references an invalid active intent");
  }
  active.state = "resolved";
  state.activeIntents.delete(active.activeIntentId);
  enemy.activeIntentId = null;
}

function applyHpChanged(state: RuntimeState, event: Extract<DomainEvent, { eventType: "hp.changed" }>): void {
  const entity = state.entities.get(event.payload.entityId);
  if (!entity || event.payload.maximum !== entity.hp.max || !Number.isInteger(event.payload.current) ||
    event.payload.current < 0 || event.payload.current > event.payload.maximum) {
    throw new Error("Replay hp.changed payload is inconsistent");
  }
  if (event.eventVersion === 2) {
    const { payload } = event;
    if (payload.formulaVersion !== DAMAGE_FORMULA_VERSION || payload.kind !== "damage" ||
      payload.defense !== entity.defense) {
      throw new Error("Replay hp.changed v2 formula/source payload is inconsistent");
    }
    const calculation = calculateDamage({ rawDamage: payload.rawDamage, defense: payload.defense, multiplier: payload.multiplier });
    const expectedCurrent = Math.max(0, Math.min(entity.hp.max, entity.hp.current - calculation.finalDamage));
    if (payload.finalDamage !== calculation.finalDamage || payload.current !== expectedCurrent ||
      (payload.publicAmount !== undefined && payload.publicAmount !== calculation.finalDamage)) {
      throw new Error("Replay hp.changed v2 damage calculation does not match the prior state");
    }
    validateDamageEventSource(state, payload.source, payload.multiplier);
  }
  entity.hp.current = event.payload.current;
  if (entity.kind === "hero" && entity.hp.current === 0) entity.aliveState = "critically_injured";
}

function applyEntityRemoved(state: RuntimeState, event: Extract<DomainEvent, { eventType: "scene.entity_removed" }>): void {
  const enemy = state.entities.get(event.payload.entityId);
  const position = event.payload.cell;
  if (!enemy || enemy.kind !== "enemy" || enemy.hp.current !== 0 || enemy.aliveState === "removed" ||
    enemy.position.x !== position.x || enemy.position.y !== position.y || enemy.activeIntentId !== null ||
    event.payload.reason !== "hp_depleted") {
    throw new Error("Replay scene.entity_removed payload is inconsistent");
  }
  const cell = state.scene.cells[cellIndex(position)];
  if (!cell || cell.occupantId !== enemy.id) throw new Error("Replay removed entity cell occupancy is inconsistent");
  cell.occupantId = null;
  enemy.aliveState = "removed";
}

function validateDamageEventSource(
  state: RuntimeState,
  source: Extract<DomainEvent, { eventType: "hp.changed"; eventVersion: 2 }>['payload']['source'],
  multiplier: number,
): void {
  const enemy = state.entities.get(source.enemyId);
  if (!enemy || enemy.kind !== "enemy" || enemy.aliveState !== "active" || enemy.hp.current === 0) {
    throw new Error("Replay damage source does not reference a living active enemy");
  }
  if (source.kind === "enemy_intent" && multiplier !== 1) {
    throw new Error("Replay enemy intent damage must use multiplier 1");
  }
  if (source.kind === "retreat_attack" && multiplier !== 1 / source.attackOrder) {
    throw new Error("Replay retreat damage multiplier does not match attack order");
  }
}

function applyModeChanged(state: RuntimeState, event: Extract<DomainEvent, { eventType: "mode.changed" }>): void {
  const hero = state.entities.get(event.payload.heroId);
  if (!hero || hero.kind !== "hero") throw new Error("Replay mode.changed references a missing hero");
  const currentMode = hero.mode ?? "out_of_combat";
  if (currentMode !== event.payload.from) throw new Error("Replay mode.changed from-value does not match current hero mode");
  if (event.payload.reason === "retreat") {
    if (event.payload.from !== "melee" || event.payload.to !== "movement") {
      throw new Error("Replay retreat mode.changed has an invalid transition");
    }
    state.scene.contactImmunityUntilTick.set(hero.id, event.serverTick + 300);
  }
  hero.mode = modeFromEvent(event.payload.to);
}

function validateRngAudit(event: DomainEvent, auditRecords: readonly RngAuditRecord[]): void {
  if (auditRecords.length > 1) throw new Error("Replay has duplicate RNG audit records for one event");
  for (const record of auditRecords) {
    if (record.algorithmVersion !== "fable.rng.v1" || !/^[0-9a-f]{64}$/.test(record.seedRef) ||
      !record.rngStateBefore.every(isUint32) || !record.rngStateAfter.every(isUint32)) {
      throw new Error("Replay RNG audit record is invalid");
    }
    const payload = event.payload as { activeIntentId?: string; seedRef?: string; reason?: string };
    if (record.forkInput.serverTick !== event.serverTick || record.forkInput.campaignId !== event.campaignId ||
      record.forkInput.sceneId !== event.sceneId || (payload.activeIntentId && record.forkInput.activeIntentId !== payload.activeIntentId) ||
      (payload.seedRef && payload.seedRef !== record.seedRef) || (event.replay && event.replay.seedRef !== record.seedRef)) {
      throw new Error("Replay RNG audit does not match its event");
    }
    if (event.eventType === "intent.target_selected" && record.forkInput.purpose !== "target_selection") {
      throw new Error("Target selection audit uses the wrong RNG purpose");
    }
    if (event.eventType === "intent.cancelled" && record.forkInput.purpose !== "fallback_selection") {
      throw new Error("Fallback audit uses the wrong RNG purpose");
    }
    if (event.eventType === "intent.started" && record.forkInput.purpose !== "target_selection") {
      throw new Error("Initial target audit uses the wrong RNG purpose");
    }
  }
  if (event.eventType === "intent.target_selected" && auditRecords.length !== 1) {
    throw new Error("intent.target_selected must have exactly one RNG audit record");
  }
  if (event.eventType === "intent.cancelled" && auditRecords.length !== 1) {
    throw new Error("intent.cancelled must have exactly one fallback RNG audit record");
  }
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function cloneInputWindow(inputWindow: RuntimeState["scene"]["inputWindow"]): RuntimeState["scene"]["inputWindow"] {
  return {
    windowId: inputWindow.windowId,
    commands: inputWindow.commands.map((command) => structuredClone(command)),
  };
}
