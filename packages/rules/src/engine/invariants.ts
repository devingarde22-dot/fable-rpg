import { cellIndex, isInBounds } from "../grid/Grid.js";
import {
  ALLY_GUARD_DEFENSE_BONUS_PERCENT,
  CARD_HAND_LIMIT,
  GRID_HEIGHT,
  GRID_WIDTH,
  type RuntimeState,
} from "./types.js";

export function assertRuntimeInvariants(state: RuntimeState): void {
  if (state.serverTick < 0 || state.sceneRevision < 0 || state.nextServerSequence < 1) {
    throw new Error("Invalid tick, revision, or sequence counter");
  }
  if (state.scene.width !== GRID_WIDTH || state.scene.height !== GRID_HEIGHT || state.scene.cells.length !== GRID_WIDTH * GRID_HEIGHT) {
    throw new Error("Scene grid must contain exactly 81 cells");
  }
  const seenOccupants = new Set<string>();
  const seenCardInstances = new Set<string>();
  for (let index = 0; index < state.scene.cells.length; index += 1) {
    const cell = state.scene.cells[index];
    if (!cell || cell.x !== index % GRID_WIDTH || cell.y !== Math.floor(index / GRID_WIDTH)) {
      throw new Error("Grid cells are not in canonical row-major order");
    }
    if (cell.occupantId === null) continue;
    if (seenOccupants.has(cell.occupantId)) throw new Error(`Entity ${cell.occupantId} occupies multiple cells`);
    seenOccupants.add(cell.occupantId);
  }
  for (const cell of state.scene.cells) {
    if (cell.occupantId === null) continue;
    const entity = state.entities.get(cell.occupantId);
    if (!entity || entity.aliveState === "removed" || !isInBounds(entity.position) ||
      entity.position.x !== cell.x || entity.position.y !== cell.y) {
      throw new Error(`Cell occupancy is inconsistent for ${cell.occupantId}`);
    }
  }
  for (const entity of state.entities.values()) {
    if (!isInBounds(entity.position)) throw new Error(`Entity ${entity.id} is outside the grid`);
    if (!Number.isInteger(entity.hp.current) || !Number.isInteger(entity.hp.max) || entity.hp.current < 0 || entity.hp.max <= 0 || entity.hp.current > entity.hp.max) {
      throw new Error(`Entity ${entity.id} has invalid HP`);
    }
    if (!Number.isFinite(entity.defense) || entity.defense < 0 || !Number.isFinite(entity.threat)) {
      throw new Error(`Entity ${entity.id} has invalid combat values`);
    }
    const statusIds = new Set<string>();
    const statusKeys = new Set<string>();
    for (const status of entity.statuses) {
      const sourceEntity = status.sourceEntityId === null ? null : state.entities.get(status.sourceEntityId);
      const expectedPotency = status.templateKey === "immobilized"
        ? 1
        : status.templateKey === "ally_guard"
          ? ALLY_GUARD_DEFENSE_BONUS_PERCENT
          : null;
      if (!status.id || statusIds.has(status.id) ||
        (status.sourceEntityId !== null && !sourceEntity) ||
        (status.templateKey === "immobilized" && entity.kind !== "hero") ||
        expectedPotency === null || statusKeys.has(status.templateKey) || status.potency !== expectedPotency || status.stacks !== 1 ||
        !Number.isInteger(status.appliedAtTick) || status.appliedAtTick < 0 ||
        !Number.isInteger(status.expiresAtTick) || status.expiresAtTick <= status.appliedAtTick ||
        status.expiresAtTick < state.serverTick || status.refreshPolicy !== "refresh_duration") {
        throw new Error(`Entity ${entity.id} has an invalid status layer ${status.id}`);
      }
      statusIds.add(status.id);
      statusKeys.add(status.templateKey);
    }
    if (entity.kind === "hero") {
      if (typeof entity.canEnterRangedMode !== "boolean") throw new Error(`Hero ${entity.id} has invalid ranged-mode capability`);
      if (!Number.isInteger(entity.cards.revision) || entity.cards.revision < 0) {
        throw new Error(`Hero ${entity.id} has an invalid card revision`);
      }
      if (entity.cards.hand.length > CARD_HAND_LIMIT) throw new Error(`Hero ${entity.id} exceeds the hand limit`);
      for (const card of [...entity.cards.drawPile, ...entity.cards.hand, ...entity.cards.discard, ...entity.cards.excludedForMode,
        ...(entity.cards.defenseSlot ? [entity.cards.defenseSlot] : [])]) {
        if (!card.instanceId || seenCardInstances.has(card.instanceId) || !state.cardTemplates.has(card.templateKey)) {
          throw new Error(`Hero ${entity.id} has a duplicate or invalid card instance ${card.instanceId}`);
        }
        seenCardInstances.add(card.instanceId);
      }
      if (entity.cards.defenseSlot) {
        const template = state.cardTemplates.get(entity.cards.defenseSlot.templateKey);
        if (!template || template.effect.kind === "direct_damage") throw new Error(`Hero ${entity.id} has an invalid defense-slot card`);
      }
      const protectionIds = new Set<string>();
      for (const protection of entity.protections) {
        const sourceCard = [...state.entities.values()].flatMap((owner) => owner.kind === "hero"
          ? [...owner.cards.drawPile, ...owner.cards.hand, ...owner.cards.discard, ...owner.cards.excludedForMode,
            ...(owner.cards.defenseSlot ? [owner.cards.defenseSlot] : [])]
          : []).find((card) => card.instanceId === protection.sourceCardInstanceId);
        if (!protection.id || protectionIds.has(protection.id) || !sourceCard ||
          (protection.kind === "damage_barrier" && (!Number.isInteger(protection.remainingAmount) || protection.remainingAmount <= 0))) {
          throw new Error(`Hero ${entity.id} has an invalid protection ${protection.id}`);
        }
        protectionIds.add(protection.id);
      }
      const inCombatMode = entity.mode === "melee" || entity.mode === "ranged";
      if (inCombatMode && entity.aliveState === "active" &&
        (!Number.isInteger(entity.cards.nextHandRotationAtTick) || entity.cards.nextHandRotationAtTick === null ||
          entity.cards.nextHandRotationAtTick < state.serverTick)) {
        throw new Error(`Hero ${entity.id} has an invalid hand rotation timer`);
      }
      if ((!inCombatMode || entity.aliveState !== "active") && entity.cards.nextHandRotationAtTick !== null) {
        throw new Error(`Hero ${entity.id} has a hand rotation timer outside active combat`);
      }
      if (!Number.isInteger(entity.stamina.current) || !Number.isInteger(entity.stamina.max) ||
        entity.stamina.max < 3 || entity.stamina.current < 0 || entity.stamina.current > entity.stamina.max) {
        throw new Error(`Hero ${entity.id} has invalid stamina`);
      }
      const staminaTimerMustBeStopped = entity.aliveState !== "active" || entity.stamina.current === entity.stamina.max;
      if (staminaTimerMustBeStopped && entity.stamina.nextRegenAtTick !== null) {
        throw new Error(`Hero ${entity.id} has an unexpected stamina regeneration timer`);
      }
      if (!staminaTimerMustBeStopped && (!Number.isInteger(entity.stamina.nextRegenAtTick) ||
        entity.stamina.nextRegenAtTick === null || entity.stamina.nextRegenAtTick < state.serverTick)) {
        throw new Error(`Hero ${entity.id} has an invalid stamina regeneration timer`);
      }
      if (entity.hp.current === 0 && entity.aliveState !== "critically_injured") {
        throw new Error(`Hero ${entity.id} with 0 HP must be critically injured`);
      }
    }
    const cell = state.scene.cells[cellIndex(entity.position)];
    if (entity.aliveState !== "removed" && cell?.occupantId !== entity.id) {
      throw new Error(`Non-removed entity ${entity.id} is not recorded as occupant`);
    }
    if (entity.aliveState === "removed" && cell?.occupantId === entity.id) {
      throw new Error(`Removed entity ${entity.id} still occupies a cell`);
    }
    if (entity.kind === "enemy" && !state.enemyTemplates.has(entity.templateKey)) {
      throw new Error(`Enemy ${entity.id} references unknown template ${entity.templateKey}`);
    }
    if (entity.kind === "enemy" && entity.activeIntentId !== null) {
      const intent = state.activeIntents.get(entity.activeIntentId);
      if (!intent || intent.ownerEntityId !== entity.id) throw new Error(`Enemy ${entity.id} has an invalid active intent reference`);
    }
  }
  for (const [heroId, untilTick] of state.scene.contactImmunityUntilTick) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.kind !== "hero" || !Number.isInteger(untilTick) || untilTick < 0) {
      throw new Error(`Invalid contact immunity entry for ${heroId}`);
    }
  }
  for (const intent of state.activeIntents.values()) {
    const enemy = state.entities.get(intent.ownerEntityId);
    const template = state.intentTemplates.get(intent.templateKey);
    if (!enemy || enemy.kind !== "enemy" || enemy.aliveState !== "active" || enemy.activeIntentId !== intent.activeIntentId) {
      throw new Error(`Active intent ${intent.activeIntentId} has no active owner`);
    }
    if (!template || intent.startedAtTick < 0 ||
      intent.resolvesAtTick !== intent.startedAtTick + template.durationMs / 50) {
      throw new Error(`Active intent ${intent.activeIntentId} has invalid template or timer`);
    }
    if (intent.targetEntityId && !state.entities.has(intent.targetEntityId)) {
      throw new Error(`Active intent ${intent.activeIntentId} references a missing target`);
    }
  }
  if (state.phase === "loading" && state.activeIntents.size !== 0) {
    throw new Error("Loading scene cannot contain started intents");
  }
}
