import { cloneRuntimeState, snapshotState } from "../engine/createRuntimeState.js";
import { assertRuntimeInvariants } from "../engine/invariants.js";
import { cellIndex, isInBounds } from "../grid/Grid.js";
import { checkMovementDestination } from "../grid/collision.js";
import { chebyshevDistance, hasLineOfSight } from "../intents/geometry.js";
import { canAffordStamina } from "../resources/stamina.js";
import { calculateDamage } from "../combat/damage.js";
import { shuffleCardInstances } from "../cards/deckLifecycle.js";
import {
  CARD_HAND_LIMIT,
  CARD_ROTATION_INTERVAL_TICKS,
  DAMAGE_FORMULA_VERSION,
  STAMINA_REGEN_INTERVAL_TICKS,
  type DomainEvent,
  type JournalRecord,
  type RuntimeSnapshot,
  type RuntimeState,
  type RngAuditRecord,
} from "../engine/types.js";
import { cloneEvent } from "../journal/EventJournal.js";
import { modeFromEvent } from "../combat/heroModes.js";
import { IMMOBILIZED_DURATION_MS, IMMOBILIZED_DURATION_TICKS } from "../engine/types.js";
import { hasActiveStatus } from "../statuses/statusSystem.js";

export function replayEvents(initialState: RuntimeState, events: readonly DomainEvent[]): RuntimeSnapshot {
  const state = cloneRuntimeState(initialState);
  state.phase = "active";
  const progress = createReplayProgress(state);
  for (const sourceEvent of events) applyReplayEvent(state, cloneEvent(sourceEvent), progress);
  assertReplayTransactionsComplete(state, progress);
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
      applyReplayEvent(state, cloneEvent(record.event), progress, record.rngAudit);
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
    assertNoDueStatuses(state, record.serverTick);
  }
  assertReplayTransactionsComplete(state, progress);
  return snapshotState(state);
}

type PendingCardPlay = {
  heroId: string;
  cardInstanceId: string;
  cardTemplateKey: string;
  targetEntityId: string;
  mode: "movement" | "melee" | "ranged";
  staminaCost: number;
  serverTick: number;
  sceneRevision: number;
  eventGroupId: string;
  requestId: string;
  actorId: string;
  stage: "stamina" | "damage" | "discard";
};

type ReplayProgress = {
  previousSequence: number;
  previousEventTick: number;
  currentGroup: string;
  expectedEventIndex: number;
  currentGroupRevision: number;
  pendingCardPlay: PendingCardPlay | null;
  pendingModeEntry: { heroId: string; mode: "melee" | "ranged"; serverTick: number; eventGroupId: string; sceneRevision: number } | null;
  pendingModeDeal: { heroId: string; expectedCardIds: string[]; serverTick: number; eventGroupId: string; sceneRevision: number } | null;
  pendingRotation: {
    heroId: string;
    dueAtTick: number;
    discardedCardInstanceId: string | null;
    drawnCardInstanceId: string | null;
    eventGroupId: string;
    sceneRevision: number;
  } | null;
  pendingBind: {
    enemyId: string;
    targetEntityId: string;
    activeIntentId: string;
    serverTick: number;
    eventGroupId: string;
    sceneRevision: number;
  } | null;
};

function createReplayProgress(state: RuntimeState): ReplayProgress {
  return {
    previousSequence: state.nextServerSequence - 1,
    previousEventTick: state.serverTick,
    currentGroup: "",
    expectedEventIndex: 0,
    currentGroupRevision: -1,
    pendingCardPlay: null,
    pendingModeEntry: null,
    pendingModeDeal: null,
    pendingRotation: null,
    pendingBind: null,
  };
}

function assertReplayTransactionsComplete(state: RuntimeState, progress: ReplayProgress): void {
  if (progress.pendingCardPlay) throw new Error("Replay ended before the card play transaction completed");
  if (progress.pendingModeEntry || progress.pendingModeDeal) throw new Error("Replay ended before the mode-entry deck deal completed");
  if (progress.pendingRotation) throw new Error("Replay ended before the timed hand rotation completed");
  if (progress.pendingBind) throw new Error("Replay ended before the bind status effect was recorded");
  assertNoDueStatuses(state, state.serverTick);
}

function assertNoDueStatuses(state: RuntimeState, serverTick: number): void {
  if ([...state.entities.values()].some((entity) => entity.statuses.some((layer) => layer.expiresAtTick <= serverTick))) {
    throw new Error("Replay ended a tick with an expired status layer still active");
  }
}

function applyReplayEvent(
  state: RuntimeState,
  event: DomainEvent,
  progress: ReplayProgress,
  rngAudit: readonly RngAuditRecord[] = [],
): void {
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
  if (progress.pendingCardPlay) {
    const expectedType = progress.pendingCardPlay.stage === "stamina"
      ? "stamina.changed"
      : progress.pendingCardPlay.stage === "damage"
        ? "hp.changed"
        : "card.discarded";
    if (event.eventType !== expectedType || event.eventGroupId !== progress.pendingCardPlay.eventGroupId ||
      event.sceneRevision !== progress.pendingCardPlay.sceneRevision || event.serverTick !== progress.pendingCardPlay.serverTick ||
      event.causedByRequestId !== progress.pendingCardPlay.requestId || event.actorId !== progress.pendingCardPlay.actorId) {
      throw new Error("Replay card-play event sequence is incomplete or inconsistent");
    }
  }
  if (progress.pendingModeEntry && (event.eventType !== "deck.shuffled" || event.eventGroupId !== progress.pendingModeEntry.eventGroupId)) {
    throw new Error("Replay mode entry must be followed by its deck.shuffled event");
  }
  if (progress.pendingModeDeal && (event.eventType !== "card.drawn" || event.eventGroupId !== progress.pendingModeDeal.eventGroupId)) {
    throw new Error("Replay mode-entry deal is incomplete or interleaved");
  }
  if (progress.pendingRotation && event.eventGroupId !== progress.pendingRotation.eventGroupId) {
    throw new Error("Replay hand rotation transaction crossed an event-group boundary");
  }
  if (progress.pendingBind && (event.eventType !== "status.applied" && event.eventType !== "status.refreshed" ||
    event.eventGroupId !== progress.pendingBind.eventGroupId || event.sceneRevision !== progress.pendingBind.sceneRevision ||
    event.serverTick !== progress.pendingBind.serverTick)) {
    throw new Error("Replay bind resolution must be followed by its status event in the same transaction");
  }
  if (event.eventGroupId !== progress.currentGroup || event.sceneRevision !== progress.currentGroupRevision || event.eventIndex !== progress.expectedEventIndex) {
    throw new Error("Replay event group, revision, or eventIndex is inconsistent");
  }
  progress.expectedEventIndex += 1;

  switch (event.eventType) {
    case "scene.entity_moved":
      applyMovement(state, event);
      break;
    case "card.played":
      applyCardPlayed(state, event, progress);
      break;
    case "card.discarded":
      applyCardDiscarded(state, event, progress);
      break;
    case "card.drawn":
      applyCardDrawn(state, event, progress);
      break;
    case "deck.shuffled":
      applyDeckShuffled(state, event, progress, rngAudit);
      break;
    case "deck.rotation_resolved":
      applyDeckRotationResolved(state, event, progress);
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
      applyIntentResolved(state, event, progress);
      break;
    case "status.applied":
      applyStatusApplied(state, event, progress);
      break;
    case "status.refreshed":
      applyStatusRefreshed(state, event, progress);
      break;
    case "status.expired":
      applyStatusExpired(state, event);
      break;
    case "hp.changed":
      applyHpChanged(state, event, progress);
      break;
    case "stamina.changed":
      applyStaminaChanged(state, event, progress);
      break;
    case "mode.changed":
      applyModeChanged(state, event, progress);
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

function applyCardPlayed(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "card.played" }>,
  progress: ReplayProgress,
): void {
  const { heroId, cardInstanceId, mode, staminaCost, targetEntityId, targetCell } = event.payload;
  const hero = state.entities.get(heroId);
  const card = hero?.kind === "hero"
    ? hero.cards.hand.find((instance) => instance.instanceId === cardInstanceId)
    : undefined;
  const template = card ? state.cardTemplates.get(card.templateKey) : undefined;
  const target = state.entities.get(targetEntityId);
  if (progress.pendingCardPlay || !hero || hero.kind !== "hero" || hero.aliveState !== "active" || hero.hp.current <= 0 ||
    event.actorId === null || state.heroIdByActorId.get(event.actorId) !== hero.id || event.causedByRequestId === null ||
    !card || !template || template.effect.kind !== "direct_damage" || template.staminaCost !== staminaCost ||
    hero.mode !== mode || !template.allowedModes.includes(mode) || !canAffordStamina(hero.stamina.current, staminaCost) ||
    !target || target.kind !== "enemy" || target.aliveState !== "active" || target.hp.current <= 0 ||
    target.position.x !== targetCell.x || target.position.y !== targetCell.y) {
    throw new Error("Replay card.played references an invalid hero, card, mode, cost, or target");
  }
  const distance = chebyshevDistance(hero.position, target.position);
  if (distance < template.range.minInclusive || distance > template.range.maxInclusive) {
    throw new Error("Replay card.played target is outside the configured range");
  }
  if (template.lineOfSight === "required" && !hasLineOfSight(state.scene.cells, hero.position, target.position)) {
    throw new Error("Replay card.played target is blocked by line of sight");
  }
  progress.pendingCardPlay = {
    heroId,
    cardInstanceId,
    cardTemplateKey: template.key,
    targetEntityId,
    mode,
    staminaCost,
    serverTick: event.serverTick,
    sceneRevision: event.sceneRevision,
    eventGroupId: event.eventGroupId,
    requestId: event.causedByRequestId,
    actorId: event.actorId,
    stage: staminaCost > 0 ? "stamina" : "damage",
  };
}

function applyMovement(state: RuntimeState, event: Extract<DomainEvent, { eventType: "scene.entity_moved" }>): void {
  const entity = state.entities.get(event.payload.entityId);
  if (!entity || entity.aliveState === "removed" || !isInBounds(event.payload.from) || !isInBounds(event.payload.to)) {
    throw new Error("Replay movement references invalid entity or cell");
  }
  if (entity.kind === "hero" && hasActiveStatus(entity, "immobilized", event.serverTick)) {
    throw new Error("Replay movement violates an active immobilized status");
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

function applyIntentResolved(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "intent.resolved" }>,
  progress: ReplayProgress,
): void {
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
  if (template.effect.handler === "bind") {
    const targetEntityId = event.payload.targetEntityId;
    const target = targetEntityId ? state.entities.get(targetEntityId) : undefined;
    if (progress.pendingBind || !target || target.aliveState !== "active" || target.hp.current <= 0) {
      throw new Error("Replay bind resolution has no valid active target");
    }
    progress.pendingBind = {
      enemyId: enemy.id,
      targetEntityId: target.id,
      activeIntentId: active.activeIntentId,
      serverTick: event.serverTick,
      eventGroupId: event.eventGroupId,
      sceneRevision: event.sceneRevision,
    };
  }
}

function applyStatusApplied(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "status.applied" }>,
  progress: ReplayProgress,
): void {
  const pending = progress.pendingBind;
  const target = state.entities.get(event.payload.entityId);
  const source = pending ? state.entities.get(pending.enemyId) : undefined;
  const timer = event.payload.timer;
  const expectedLayerId = pending
    ? `status:${pending.targetEntityId}:immobilized:${pending.enemyId}:${pending.activeIntentId}`
    : "";
  if (!pending || !target || !source || source.kind !== "enemy" || target.id !== pending.targetEntityId ||
    event.actorId !== pending.enemyId || event.causedByRequestId !== null || event.payload.statusKey !== "immobilized" ||
    event.payload.layerId !== expectedLayerId || event.serverTick !== pending.serverTick ||
    timer.startedAtTick !== event.serverTick || timer.resolvesAtTick !== event.serverTick + IMMOBILIZED_DURATION_TICKS ||
    timer.durationMs !== IMMOBILIZED_DURATION_MS || timer.remainingMs !== IMMOBILIZED_DURATION_MS || timer.paused !== false ||
    (event.payload.publicPotency !== undefined && event.payload.publicPotency !== 1) ||
    target.statuses.some((layer) => layer.templateKey === "immobilized" && layer.expiresAtTick >= event.serverTick)) {
    throw new Error("Replay status.applied does not match a valid bind intent");
  }
  target.statuses.push({
    id: event.payload.layerId,
    templateKey: "immobilized",
    sourceEntityId: source.id,
    potency: event.payload.publicPotency ?? 1,
    stacks: 1,
    appliedAtTick: event.serverTick,
    expiresAtTick: timer.resolvesAtTick,
    refreshPolicy: "refresh_duration",
  });
  progress.pendingBind = null;
}

function applyStatusRefreshed(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "status.refreshed" }>,
  progress: ReplayProgress,
): void {
  const pending = progress.pendingBind;
  const target = state.entities.get(event.payload.entityId);
  const source = pending ? state.entities.get(pending.enemyId) : undefined;
  const layer = target?.statuses.find((candidate) => candidate.id === event.payload.layerId);
  const timer = event.payload.timer;
  if (!pending || !target || !source || source.kind !== "enemy" || target.id !== pending.targetEntityId ||
    event.actorId !== pending.enemyId || event.causedByRequestId !== null || event.payload.statusKey !== "immobilized" ||
    !layer || layer.templateKey !== "immobilized" || layer.refreshPolicy !== "refresh_duration" ||
    layer.expiresAtTick < event.serverTick || event.serverTick !== pending.serverTick ||
    timer.startedAtTick !== event.serverTick || timer.resolvesAtTick !== event.serverTick + IMMOBILIZED_DURATION_TICKS ||
    timer.durationMs !== IMMOBILIZED_DURATION_MS || timer.remainingMs !== IMMOBILIZED_DURATION_MS || timer.paused !== false ||
    (event.payload.publicPotency !== undefined && event.payload.publicPotency !== 1)) {
    throw new Error("Replay status.refreshed does not match an existing bind status layer");
  }
  layer.appliedAtTick = event.serverTick;
  layer.expiresAtTick = timer.resolvesAtTick;
  progress.pendingBind = null;
}

function applyStatusExpired(state: RuntimeState, event: Extract<DomainEvent, { eventType: "status.expired" }>): void {
  if (event.actorId !== null || event.causedByRequestId !== null) throw new Error("Replay status.expired cannot be command-caused");
  const nextDue = [...state.entities.values()]
    .flatMap((entity) => entity.statuses
      .filter((layer) => layer.expiresAtTick <= event.serverTick)
      .map((layer) => ({ entity, layer })))
    .sort((a, b) => compareText(a.entity.id, b.entity.id) || compareText(a.layer.id, b.layer.id))[0];
  if (!nextDue || nextDue.entity.id !== event.payload.entityId || nextDue.layer.id !== event.payload.layerId ||
    nextDue.layer.templateKey !== event.payload.statusKey || nextDue.layer.expiresAtTick !== event.serverTick) {
    throw new Error("Replay status.expired does not match the next deterministic due layer");
  }
  nextDue.entity.statuses.splice(nextDue.entity.statuses.indexOf(nextDue.layer), 1);
}

function applyHpChanged(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "hp.changed" }>,
  progress: ReplayProgress,
): void {
  const entity = state.entities.get(event.payload.entityId);
  if (!entity || event.payload.maximum !== entity.hp.max || !Number.isInteger(event.payload.current) ||
    event.payload.current < 0 || event.payload.current > event.payload.maximum) {
    throw new Error("Replay hp.changed payload is inconsistent");
  }
  if (progress.pendingCardPlay && (progress.pendingCardPlay.stage !== "damage" || event.eventVersion !== 2 ||
    event.payload.entityId !== progress.pendingCardPlay.targetEntityId || event.payload.source.kind !== "card")) {
    throw new Error("Replay card play is missing its matching source and target hp.changed event");
  }
  if (!progress.pendingCardPlay && event.eventVersion === 2 && event.payload.source.kind === "card") {
    throw new Error("Replay card damage is not linked to a successful card.played event");
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
    validateDamageEventSource(state, payload.source, payload.rawDamage, payload.multiplier, progress.pendingCardPlay);
  }
  entity.hp.current = event.payload.current;
  if (entity.kind === "hero" && entity.hp.current === 0) {
    entity.aliveState = "critically_injured";
    entity.stamina.nextRegenAtTick = null;
    entity.cards.nextHandRotationAtTick = null;
  }
  if (progress.pendingCardPlay) progress.pendingCardPlay.stage = "discard";
}

function applyStaminaChanged(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "stamina.changed" }>,
  progress: ReplayProgress,
): void {
  const hero = state.entities.get(event.payload.heroId);
  if (event.payload.reason === "card_cost") {
    const pending = progress.pendingCardPlay;
    if (!hero || hero.kind !== "hero" || !pending || pending.stage !== "stamina" || pending.staminaCost <= 0 ||
      pending.heroId !== hero.id || pending.serverTick !== event.serverTick ||
      state.heroIdByActorId.get(event.actorId ?? "") !== hero.id ||
      event.payload.maximum !== hero.stamina.max || event.payload.current !== hero.stamina.current - pending.staminaCost ||
      event.payload.current < 0 || event.payload.current >= hero.stamina.max) {
      throw new Error("Replay stamina.changed card_cost does not match the pending card play");
    }
    hero.stamina.current = event.payload.current;
    hero.stamina.nextRegenAtTick = event.serverTick + STAMINA_REGEN_INTERVAL_TICKS;
    pending.stage = "damage";
    return;
  }
  if (progress.pendingCardPlay) throw new Error("Replay stamina regeneration interrupted a card-play transaction");
  if (!hero || hero.kind !== "hero" || hero.aliveState !== "active" ||
    event.payload.reason !== "regeneration" || event.payload.maximum !== hero.stamina.max ||
    !Number.isInteger(event.payload.current) || event.payload.current !== hero.stamina.current + 1 ||
    event.payload.current > hero.stamina.max || hero.stamina.nextRegenAtTick !== event.serverTick) {
    throw new Error("Replay stamina.changed payload does not match the due regeneration transition");
  }
  hero.stamina.current = event.payload.current;
  hero.stamina.nextRegenAtTick = hero.stamina.current < hero.stamina.max
    ? event.serverTick + STAMINA_REGEN_INTERVAL_TICKS
    : null;
}

function applyCardDiscarded(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "card.discarded" }>,
  progress: ReplayProgress,
): void {
  const hero = state.entities.get(event.payload.heroId);
  if (!hero || hero.kind !== "hero" || event.payload.discardRevision !== hero.cards.revision + 1) {
    throw new Error("Replay card.discarded references an invalid hero or revision");
  }
  if (event.payload.reason === "played") {
    const pending = progress.pendingCardPlay;
    const cardIndex = hero.cards.hand.findIndex((instance) => instance.instanceId === event.payload.cardInstanceId);
    const card = cardIndex >= 0 ? hero.cards.hand[cardIndex] : undefined;
    if (!pending || pending.stage !== "discard" || !card || pending.heroId !== hero.id ||
      pending.cardInstanceId !== card.instanceId || card.templateKey !== pending.cardTemplateKey) {
      throw new Error("Replay card.discarded does not match the completed card play");
    }
    hero.cards.hand.splice(cardIndex, 1);
    hero.cards.discard.push({ ...card });
    hero.cards.revision = event.payload.discardRevision;
    progress.pendingCardPlay = null;
    return;
  }

  if ((hero.mode !== "melee" && hero.mode !== "ranged") || hero.aliveState !== "active" ||
    hero.cards.nextHandRotationAtTick !== event.serverTick || hero.cards.hand.length !== CARD_HAND_LIMIT) {
    throw new Error("Replay timer discard is not due for a full active combat hand");
  }
  const rightmost = hero.cards.hand.at(-1);
  if (!rightmost || rightmost.instanceId !== event.payload.cardInstanceId || progress.pendingCardPlay) {
    throw new Error("Replay timer discard does not reference the rightmost card");
  }
  hero.cards.hand.pop();
  hero.cards.discard.push({ ...rightmost });
  hero.cards.revision = event.payload.discardRevision;
  progress.pendingRotation = progress.pendingRotation ?? {
    heroId: hero.id,
    dueAtTick: event.serverTick,
    discardedCardInstanceId: null,
    drawnCardInstanceId: null,
    eventGroupId: event.eventGroupId,
    sceneRevision: event.sceneRevision,
  };
  if (progress.pendingRotation.heroId !== hero.id || progress.pendingRotation.dueAtTick !== event.serverTick ||
    progress.pendingRotation.discardedCardInstanceId !== null) {
    throw new Error("Replay has conflicting timer-discard events");
  }
  progress.pendingRotation.discardedCardInstanceId = rightmost.instanceId;
}

function applyCardDrawn(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "card.drawn" }>,
  progress: ReplayProgress,
): void {
  const { heroId, cardInstanceId, reason, destination, cardRevision } = event.payload;
  const hero = state.entities.get(heroId);
  if (!hero || hero.kind !== "hero" || destination !== "hand" || cardRevision !== hero.cards.revision + 1 ||
    hero.cards.hand.length >= CARD_HAND_LIMIT) {
    throw new Error("Replay card.drawn references an invalid hero, destination, hand or revision");
  }
  if (reason === "mode_entry") {
    const pending = progress.pendingModeDeal;
    if (!pending || pending.heroId !== hero.id || pending.serverTick !== event.serverTick ||
      pending.eventGroupId !== event.eventGroupId || pending.sceneRevision !== event.sceneRevision ||
      pending.expectedCardIds.shift() !== cardInstanceId) {
      throw new Error("Replay mode-entry card.drawn is not the next shuffled card");
    }
  } else {
    if ((hero.mode !== "melee" && hero.mode !== "ranged") || hero.aliveState !== "active" ||
      hero.cards.nextHandRotationAtTick !== event.serverTick || progress.pendingModeDeal) {
      throw new Error("Replay timer card.drawn is not due for an active combat hero");
    }
    progress.pendingRotation = progress.pendingRotation ?? {
      heroId: hero.id,
      dueAtTick: event.serverTick,
      discardedCardInstanceId: null,
      drawnCardInstanceId: null,
      eventGroupId: event.eventGroupId,
      sceneRevision: event.sceneRevision,
    };
    if (progress.pendingRotation.heroId !== hero.id || progress.pendingRotation.dueAtTick !== event.serverTick ||
      progress.pendingRotation.drawnCardInstanceId !== null) {
      throw new Error("Replay has conflicting timer draw events");
    }
  }

  const card = hero.cards.drawPile[0];
  if (!card || card.instanceId !== cardInstanceId) throw new Error("Replay card.drawn is not the top card of drawPile");
  hero.cards.drawPile.shift();
  hero.cards.hand.unshift({ ...card });
  hero.cards.revision = cardRevision;
  if (reason === "mode_entry") {
    if (progress.pendingModeDeal?.expectedCardIds.length === 0) progress.pendingModeDeal = null;
  } else if (progress.pendingRotation) {
    progress.pendingRotation.drawnCardInstanceId = cardInstanceId;
  }
}

function applyDeckShuffled(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "deck.shuffled" }>,
  progress: ReplayProgress,
  rngAudit: readonly RngAuditRecord[],
): void {
  const payload = event.payload;
  const hero = state.entities.get(payload.heroId);
  if (!hero || hero.kind !== "hero" || hero.mode !== payload.mode || hero.aliveState !== "active" ||
    payload.cardRevision !== hero.cards.revision + 1 || !event.replay) {
    throw new Error("Replay deck.shuffled references an invalid hero, mode, revision or seed");
  }

  const allCards = [...hero.cards.drawPile, ...hero.cards.hand, ...hero.cards.discard, ...hero.cards.excludedForMode]
    .sort((a, b) => compareText(a.instanceId, b.instanceId));
  let expectedSource: typeof allCards;
  let expectedEligible: typeof allCards;
  let expectedExcluded: typeof allCards;
  if (payload.reason === "mode_entry") {
    const entry = progress.pendingModeEntry;
    if (!entry || entry.heroId !== hero.id || entry.mode !== payload.mode || entry.serverTick !== event.serverTick ||
      entry.eventGroupId !== event.eventGroupId || entry.sceneRevision !== event.sceneRevision) {
      throw new Error("Replay mode-entry shuffle is not immediately linked to mode.changed");
    }
    expectedSource = allCards;
    expectedEligible = allCards.filter((card) => state.cardTemplates.get(card.templateKey)?.allowedModes.includes(payload.mode));
    expectedExcluded = allCards.filter((card) => !state.cardTemplates.get(card.templateKey)?.allowedModes.includes(payload.mode));
  } else {
    if (progress.pendingModeEntry || hero.cards.drawPile.length !== 0 || hero.cards.nextHandRotationAtTick !== event.serverTick) {
      throw new Error("Replay discard shuffle is not due after draw-pile exhaustion");
    }
    expectedSource = [...hero.cards.discard].sort((a, b) => compareText(a.instanceId, b.instanceId));
    expectedEligible = expectedSource;
    expectedExcluded = [];
    progress.pendingRotation = progress.pendingRotation ?? {
      heroId: hero.id,
      dueAtTick: event.serverTick,
      discardedCardInstanceId: null,
      drawnCardInstanceId: null,
      eventGroupId: event.eventGroupId,
      sceneRevision: event.sceneRevision,
    };
    if (progress.pendingRotation.heroId !== hero.id || progress.pendingRotation.dueAtTick !== event.serverTick) {
      throw new Error("Replay discard shuffle conflicts with another rotation");
    }
  }

  const sourceIds = expectedSource.map((card) => card.instanceId);
  const eligibleIds = expectedEligible.map((card) => card.instanceId);
  const excludedIds = expectedExcluded.map((card) => card.instanceId);
  if (!sameIds(payload.sourceCardInstanceIds, sourceIds) || !sameIds(payload.eligibleCardInstanceIds, eligibleIds) ||
    !sameIds(payload.excludedCardInstanceIds, excludedIds)) {
    throw new Error("Replay deck.shuffled source or mode-filter partition is invalid");
  }

  const expectedOperationId = payload.reason === "mode_entry"
    ? `deck:${hero.id}:${payload.mode}:mode_entry:${hero.cards.revision + 1}`
    : `deck:${hero.id}:${payload.mode}:discard_exhausted:${hero.cards.revision + 1}`;
  if (payload.operationId !== expectedOperationId) throw new Error("Replay deck shuffle operation ID is not canonical");
  const forkInput = {
    rootSeed: state.rootSeed,
    campaignId: state.campaignId,
    sceneId: state.scene.id,
    serverTick: event.serverTick,
    activeIntentId: expectedOperationId,
    purpose: "deck_shuffle" as const,
  };
  const shuffled = shuffleCardInstances(expectedEligible, forkInput);
  const shuffledIds = shuffled.cards.map((card) => card.instanceId);
  if (!sameIds(payload.orderedCardInstanceIds, shuffledIds) || event.replay.seedRef !== shuffled.audit.seedRef) {
    throw new Error("Replay deck shuffle order or seedRef does not match deterministic RNG");
  }
  if (rngAudit.length > 0 && (rngAudit.length !== 1 || JSON.stringify(rngAudit[0]) !== JSON.stringify(shuffled.audit))) {
    throw new Error("Replay deck shuffle RNG audit state does not match recomputed shuffle");
  }

  if (payload.reason === "mode_entry") {
    hero.cards.drawPile = shuffled.cards;
    hero.cards.hand = [];
    hero.cards.discard = [];
    hero.cards.excludedForMode = expectedExcluded.map((card) => ({ ...card }));
    progress.pendingModeEntry = null;
    const drawCount = Math.min(CARD_HAND_LIMIT, shuffled.cards.length);
    progress.pendingModeDeal = drawCount === 0 ? null : {
      heroId: hero.id,
      expectedCardIds: shuffledIds.slice(0, drawCount),
      serverTick: event.serverTick,
      eventGroupId: event.eventGroupId,
      sceneRevision: event.sceneRevision,
    };
  } else {
    hero.cards.drawPile = shuffled.cards;
    hero.cards.discard = [];
  }
  hero.cards.revision = payload.cardRevision;
}

function applyDeckRotationResolved(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "deck.rotation_resolved" }>,
  progress: ReplayProgress,
): void {
  const payload = event.payload;
  const hero = state.entities.get(payload.heroId);
  if (!hero || hero.kind !== "hero" || hero.aliveState !== "active" ||
    (hero.mode !== "melee" && hero.mode !== "ranged") || hero.cards.nextHandRotationAtTick !== payload.dueAtTick ||
    event.serverTick !== payload.dueAtTick || payload.nextHandRotationAtTick !== payload.dueAtTick + CARD_ROTATION_INTERVAL_TICKS ||
    payload.cardRevision !== hero.cards.revision) {
    throw new Error("Replay deck.rotation_resolved is not the exact due timer transition");
  }
  const pending = progress.pendingRotation;
  if (pending && (pending.heroId !== hero.id || pending.dueAtTick !== payload.dueAtTick ||
    pending.eventGroupId !== event.eventGroupId || pending.sceneRevision !== event.sceneRevision ||
    pending.discardedCardInstanceId !== payload.discardedCardInstanceId ||
    pending.drawnCardInstanceId !== payload.drawnCardInstanceId)) {
    throw new Error("Replay rotation outcome does not match preceding discard/draw events");
  }
  if (!pending && (payload.discardedCardInstanceId !== null || payload.drawnCardInstanceId !== null)) {
    throw new Error("Replay rotation outcome names an unrecorded card mutation");
  }
  if (payload.discardedCardInstanceId !== null && payload.drawnCardInstanceId === null) {
    throw new Error("A full-hand rotation must draw after moving the rightmost card to discard");
  }
  if (payload.drawnCardInstanceId === null &&
    (hero.cards.drawPile.length > 0 || hero.cards.discard.length > 0 || hero.cards.hand.length >= CARD_HAND_LIMIT)) {
    throw new Error("Replay omitted a draw or required discard reshuffle during rotation");
  }
  hero.cards.nextHandRotationAtTick = payload.nextHandRotationAtTick;
  progress.pendingRotation = null;
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
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
  rawDamage: number,
  multiplier: number,
  pendingCardPlay: PendingCardPlay | null,
): void {
  if (source.kind === "card") {
    const hero = state.entities.get(source.heroId);
    const card = hero?.kind === "hero"
      ? hero.cards.hand.find((instance) => instance.instanceId === source.cardInstanceId)
      : undefined;
    const template = state.cardTemplates.get(source.cardTemplateKey);
    if (!pendingCardPlay || pendingCardPlay.stage !== "damage" || !hero || hero.kind !== "hero" ||
      hero.aliveState !== "active" || hero.hp.current <= 0 || !card || card.templateKey !== source.cardTemplateKey ||
      pendingCardPlay.heroId !== source.heroId || pendingCardPlay.cardInstanceId !== source.cardInstanceId ||
      pendingCardPlay.cardTemplateKey !== source.cardTemplateKey || !template || template.effect.kind !== "direct_damage" ||
      rawDamage !== template.effect.rawDamage || multiplier !== template.effect.multiplier) {
      throw new Error("Replay card damage source does not match its pending card play");
    }
    return;
  }
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

function applyModeChanged(
  state: RuntimeState,
  event: Extract<DomainEvent, { eventType: "mode.changed" }>,
  progress: ReplayProgress,
): void {
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
  const nextMode = modeFromEvent(event.payload.to);
  if (nextMode === "melee" || nextMode === "ranged") {
    if (hero.mode === null || hero.mode === "movement") {
      hero.cards.nextHandRotationAtTick = event.serverTick + CARD_ROTATION_INTERVAL_TICKS;
    } else if (hero.cards.nextHandRotationAtTick === null) {
      throw new Error("Replay combat mode switch has no continuous hand rotation timer");
    }
    progress.pendingModeEntry = {
      heroId: hero.id,
      mode: nextMode,
      serverTick: event.serverTick,
      eventGroupId: event.eventGroupId,
      sceneRevision: event.sceneRevision,
    };
  } else {
    hero.cards.nextHandRotationAtTick = null;
  }
  hero.mode = nextMode;
}

function validateRngAudit(event: DomainEvent, auditRecords: readonly RngAuditRecord[]): void {
  if (auditRecords.length > 1) throw new Error("Replay has duplicate RNG audit records for one event");
  for (const record of auditRecords) {
    if (record.algorithmVersion !== "fable.rng.v1" || !/^[0-9a-f]{64}$/.test(record.seedRef) ||
      !record.rngStateBefore.every(isUint32) || !record.rngStateAfter.every(isUint32)) {
      throw new Error("Replay RNG audit record is invalid");
    }
    const payload = event.payload as { activeIntentId?: string; operationId?: string; seedRef?: string; reason?: string };
    if (record.forkInput.serverTick !== event.serverTick || record.forkInput.campaignId !== event.campaignId ||
      record.forkInput.sceneId !== event.sceneId || (payload.activeIntentId && record.forkInput.activeIntentId !== payload.activeIntentId) ||
      (payload.operationId && record.forkInput.activeIntentId !== payload.operationId) ||
      (payload.seedRef && payload.seedRef !== record.seedRef) || (event.replay && event.replay.seedRef !== record.seedRef)) {
      throw new Error("Replay RNG audit does not match its event");
    }
    if (event.eventType === "deck.shuffled" && record.forkInput.purpose !== "deck_shuffle") {
      throw new Error("Deck shuffle audit uses the wrong RNG purpose");
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
  if (event.eventType === "deck.shuffled" && auditRecords.length !== 1) {
    throw new Error("deck.shuffled must have exactly one deck_shuffle audit record");
  }
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cloneInputWindow(inputWindow: RuntimeState["scene"]["inputWindow"]): RuntimeState["scene"]["inputWindow"] {
  return {
    windowId: inputWindow.windowId,
    commands: inputWindow.commands.map((command) => structuredClone(command)),
  };
}
