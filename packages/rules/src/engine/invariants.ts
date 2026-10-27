import { cellIndex, isInBounds } from "../grid/Grid.js";
import { GRID_HEIGHT, GRID_WIDTH, type RuntimeState } from "./types.js";

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
    if (entity.kind === "hero") {
      if (typeof entity.canEnterRangedMode !== "boolean") throw new Error(`Hero ${entity.id} has invalid ranged-mode capability`);
      if (!Number.isInteger(entity.cards.revision) || entity.cards.revision < 0) {
        throw new Error(`Hero ${entity.id} has an invalid card revision`);
      }
      for (const card of [...entity.cards.hand, ...entity.cards.discard]) {
        if (!card.instanceId || seenCardInstances.has(card.instanceId) || !state.cardTemplates.has(card.templateKey)) {
          throw new Error(`Hero ${entity.id} has a duplicate or invalid card instance ${card.instanceId}`);
        }
        seenCardInstances.add(card.instanceId);
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
