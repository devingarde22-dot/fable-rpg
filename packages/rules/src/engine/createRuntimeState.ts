import { createGrid, cellIndex, isInBounds } from "../grid/Grid.js";
import { cloneIntentTemplate, buildEnemyRegistry, buildIntentRegistry } from "../intents/registry.js";
import {
  ALLY_GUARD_DEFENSE_BONUS_PERCENT,
  CARD_ROTATION_INTERVAL_TICKS,
  GRID_HEIGHT,
  GRID_WIDTH,
  INITIAL_STAMINA,
  STAMINA_REGEN_INTERVAL_TICKS,
  type ActiveIntent,
  type CardTemplate,
  type EntityRuntime,
  type RuntimeState,
  type RuntimeSnapshot,
  type SimulationEngineRestoreConfig,
  type SimulationEngineConfig,
  type StatusLayer,
} from "./types.js";
import { assertRuntimeInvariants } from "./invariants.js";

export function createRuntimeState(config: SimulationEngineConfig): RuntimeState {
  const intentTemplates = buildIntentRegistry(config.intentTemplates);
  const enemyTemplates = buildEnemyRegistry(config.enemyTemplates, intentTemplates);
  const cardTemplates = buildCardTemplateRegistry(config.cardTemplates ?? []);
  const entities = new Map<string, EntityRuntime>();
  const cells = createGrid(config.terrain);
  const initialServerTick = config.initialServerTick ?? 0;
  const playerEntityIds: string[] = [];
  const enemyEntityIds: string[] = [];
  const seenCardInstances = new Set<string>();

  for (const source of config.entities) {
    if (entities.has(source.id)) throw new Error(`Duplicate entity id: ${source.id}`);
    let entity: EntityRuntime;
    if (source.kind === "enemy") {
      const template = enemyTemplates.get(source.templateKey);
      if (!template) throw new Error(`Enemy ${source.id} references unknown template ${source.templateKey}`);
      if (source.activeIntentId !== null) throw new Error(`Enemy ${source.id} cannot begin with an active intent`);
      entity = {
        ...source,
        hp: { current: template.hp, max: template.hp },
        defense: template.defense,
        threat: source.threat,
        statuses: cloneAndValidateStatusLayers(source.statuses, source.id),
        position: { ...source.position },
        activeIntentId: null,
      };
    } else {
      if (source.stamina.current !== INITIAL_STAMINA || source.stamina.max < INITIAL_STAMINA) {
        throw new Error(`Hero ${source.id} must start with ${INITIAL_STAMINA} stamina and a sufficient maximum`);
      }
      entity = {
        ...source,
        hp: { ...source.hp },
        stamina: {
          ...source.stamina,
          nextRegenAtTick: source.aliveState === "active" && source.stamina.current < source.stamina.max
            ? initialServerTick + STAMINA_REGEN_INTERVAL_TICKS
            : null,
        },
        cards: {
          drawPile: cloneAndValidateCardInstances(source.cards.drawPile, cardTemplates, seenCardInstances, source.id),
          hand: cloneAndValidateCardInstances(source.cards.hand, cardTemplates, seenCardInstances, source.id),
          discard: cloneAndValidateCardInstances(source.cards.discard, cardTemplates, seenCardInstances, source.id),
          excludedForMode: cloneAndValidateCardInstances(source.cards.excludedForMode, cardTemplates, seenCardInstances, source.id),
          defenseSlot: source.cards.defenseSlot
            ? cloneAndValidateCardInstances([source.cards.defenseSlot], cardTemplates, seenCardInstances, source.id)[0] ?? null
            : null,
          revision: source.cards.revision,
          nextHandRotationAtTick: source.cards.nextHandRotationAtTick ??
            (source.aliveState === "active" && (source.mode === "melee" || source.mode === "ranged")
              ? initialServerTick + CARD_ROTATION_INTERVAL_TICKS
              : null),
        },
        protections: source.protections.map((protection) => ({ ...protection })),
        statuses: cloneAndValidateStatusLayers(source.statuses, source.id),
        position: { ...source.position },
        activeIntentId: null,
      };
    }
    if (!isInBounds(entity.position)) throw new Error(`Entity ${entity.id} starts outside the grid`);
    const cell = cells[cellIndex(entity.position)];
    if (!cell) throw new Error(`Missing cell at ${entity.position.x},${entity.position.y}`);
    if (cell.blocksMovement) throw new Error(`Entity ${entity.id} starts on blocked terrain`);
    if (cell.occupantId !== null) throw new Error(`Entities overlap at ${entity.position.x},${entity.position.y}`);
    if (entity.aliveState !== "removed") cell.occupantId = entity.id;
    entities.set(entity.id, entity);
    if (entity.kind === "hero") playerEntityIds.push(entity.id);
    else enemyEntityIds.push(entity.id);
  }

  const heroIdByActorId = new Map(Object.entries(config.heroIdByActorId));
  const ownedHeroIds = new Set<string>();
  for (const [actorId, heroId] of heroIdByActorId) {
    const hero = entities.get(heroId);
    if (!hero || hero.kind !== "hero" ||
      (hero.aliveState !== "active" && !(hero.aliveState === "critically_injured" && hero.hp.current === 0))) {
      throw new Error(`Actor ${actorId} is mapped to an invalid hero ${heroId}`);
    }
    if (ownedHeroIds.has(heroId)) throw new Error(`Hero ${heroId} is mapped to more than one player actor`);
    ownedHeroIds.add(heroId);
  }

  const initialIntentEntries = config.initialIntentByEnemyId === undefined
    ? [...entities.values()]
      .filter((entity): entity is Extract<EntityRuntime, { kind: "enemy" }> => entity.kind === "enemy" && entity.aliveState === "active" && entity.hp.current > 0)
      .flatMap((entity) => {
        const initialIntentKey = enemyTemplates.get(entity.templateKey)?.initialIntentKey;
        return initialIntentKey ? [[entity.id, initialIntentKey] as const] : [];
      })
    : Object.entries(config.initialIntentByEnemyId);
  const initialIntentByEnemyId = new Map(initialIntentEntries);
  for (const [enemyId, intentKey] of initialIntentByEnemyId) {
    const entity = entities.get(enemyId);
    const enemyTemplate = entity?.kind === "enemy" ? enemyTemplates.get(entity.templateKey) : undefined;
    const intentTemplate = intentTemplates.get(intentKey);
    if (!entity || entity.kind !== "enemy" || entity.aliveState !== "active" || entity.hp.current === 0 || !enemyTemplate || !intentTemplate) {
      throw new Error(`Invalid initial intent ${intentKey} for enemy ${enemyId}`);
    }
    if (!enemyTemplate.intentKeys.includes(intentKey)) {
      throw new Error(`Initial intent ${intentKey} is not allowed by enemy template ${enemyTemplate.key}`);
    }
    if (intentTemplate.status !== "confirmed") throw new Error(`Initial intent ${intentKey} is not confirmed`);
    if (!isRuntimeHandler(intentTemplate.effect.handler)) {
      throw new Error(`Initial intent ${intentKey} uses an unimplemented runtime handler`);
    }
  }

  if (initialIntentByEnemyId.size > 0 && initialServerTick !== 0) {
    throw new Error("Initial intents can only start during the loading-to-active transition at serverTick 0");
  }
  const state: RuntimeState = {
    campaignId: config.campaignId,
    sessionId: config.sessionId,
    scene: {
      id: config.sceneId,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      cells,
      playerEntityIds: playerEntityIds.sort(),
      enemyEntityIds: enemyEntityIds.sort(),
      inputWindow: { windowId: Math.floor(initialServerTick / 5), commands: [] },
      startedAtTick: initialServerTick,
      contactImmunityUntilTick: new Map(),
    },
    entities,
    activeIntents: new Map(),
    cardTemplates,
    enemyTemplates,
    intentTemplates,
    initialIntentByEnemyId,
    heroIdByActorId,
    serverTick: initialServerTick,
    sceneRevision: config.initialSceneRevision ?? 0,
    nextServerSequence: config.initialServerSequence ?? 1,
    rootSeed: config.rootSeed,
    phase: "loading",
    paused: false,
    outcome: null,
  };
  assertRuntimeInvariants(state);
  return state;
}

/**
 * Hydrates a persisted snapshot using the current immutable content catalogs.
 * Catalogs stay outside the snapshot so a restore cannot silently invent or alter rules.
 */
export function createRuntimeStateFromSnapshot(snapshot: RuntimeSnapshot, config: SimulationEngineRestoreConfig): RuntimeState {
  if (!snapshot.campaignId.trim() || !snapshot.sessionId.trim() || !snapshot.scene.id.trim()) {
    throw new Error("A persisted snapshot must have campaign, session and scene ids");
  }
  const terrain = config.terrain ?? snapshot.scene.cells
    .filter((cell) => cell.terrain !== "floor")
    .map((cell) => ({ cell: { x: cell.x, y: cell.y }, terrain: cell.terrain }));
  const entities = snapshot.entities.map((entity) => entity.kind === "enemy"
    ? { ...entity, activeIntentId: null }
    : { ...entity, stamina: { ...entity.stamina, current: INITIAL_STAMINA, nextRegenAtTick: null } });
  const base = createRuntimeState({
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
    sceneId: snapshot.scene.id,
    rootSeed: snapshot.rootSeed,
    ...(config.cardTemplates ? { cardTemplates: config.cardTemplates } : {}),
    terrain,
    entities,
    enemyTemplates: config.enemyTemplates,
    intentTemplates: config.intentTemplates,
    initialIntentByEnemyId: {},
    heroIdByActorId: Object.fromEntries(snapshot.heroIdByActorId),
  });
  base.scene = {
    ...snapshot.scene,
    cells: snapshot.scene.cells.map((cell) => ({ ...cell })),
    playerEntityIds: [...snapshot.scene.playerEntityIds],
    enemyEntityIds: [...snapshot.scene.enemyEntityIds],
    contactImmunityUntilTick: new Map(snapshot.scene.contactImmunityUntilTick),
    inputWindow: {
      windowId: snapshot.scene.inputWindow.windowId,
      commands: snapshot.scene.inputWindow.commands.map((command) => structuredClone(command)),
    },
  };
  base.entities = new Map(snapshot.entities.map((entity) => [entity.id, cloneEntity(entity)]));
  base.activeIntents = new Map(snapshot.activeIntents.map((intent) => [intent.activeIntentId, cloneActiveIntent(intent)]));
  base.heroIdByActorId = new Map(snapshot.heroIdByActorId);
  base.serverTick = snapshot.serverTick;
  base.sceneRevision = snapshot.sceneRevision;
  base.nextServerSequence = snapshot.nextServerSequence;
  base.rootSeed = snapshot.rootSeed;
  base.phase = snapshot.phase;
  base.paused = snapshot.paused;
  base.outcome = snapshot.outcome;
  assertRuntimeInvariants(base);
  return base;
}

export function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    scene: {
      ...state.scene,
      cells: state.scene.cells.map((cell) => ({ ...cell })),
      playerEntityIds: [...state.scene.playerEntityIds],
      enemyEntityIds: [...state.scene.enemyEntityIds],
      contactImmunityUntilTick: new Map(state.scene.contactImmunityUntilTick),
      inputWindow: {
        windowId: state.scene.inputWindow.windowId,
        commands: state.scene.inputWindow.commands.map((command) => structuredClone(command)),
      },
    },
    entities: new Map([...state.entities].map(([id, entity]) => [id, cloneEntity(entity)])),
    activeIntents: new Map([...state.activeIntents].map(([id, intent]) => [id, cloneActiveIntent(intent)])),
    cardTemplates: new Map([...state.cardTemplates].map(([key, template]) => [key, cloneCardTemplate(template)])),
    enemyTemplates: new Map([...state.enemyTemplates].map(([key, template]) => [key, {
      ...template,
      basicAttack: { ...template.basicAttack },
      intentKeys: [...template.intentKeys],
    }])),
    intentTemplates: new Map([...state.intentTemplates].map(([key, template]) => [key, cloneIntentTemplate(template)])),
    initialIntentByEnemyId: new Map(state.initialIntentByEnemyId),
    heroIdByActorId: new Map(state.heroIdByActorId),
  };
}

export function snapshotState(state: RuntimeState): RuntimeSnapshot {
  const copy = cloneRuntimeState(state);
  return {
    campaignId: copy.campaignId,
    sessionId: copy.sessionId,
    scene: copy.scene,
    entities: [...copy.entities.values()].sort((a, b) => compareText(a.id, b.id)),
    activeIntents: [...copy.activeIntents.values()].sort((a, b) => compareText(a.activeIntentId, b.activeIntentId)),
    heroIdByActorId: [...copy.heroIdByActorId.entries()].sort(([a], [b]) => compareText(a, b)),
    serverTick: copy.serverTick,
    sceneRevision: copy.sceneRevision,
    nextServerSequence: copy.nextServerSequence,
    rootSeed: copy.rootSeed,
    phase: copy.phase,
    paused: copy.paused,
    outcome: copy.outcome,
  };
}

export function cloneEntity(entity: EntityRuntime): EntityRuntime {
  if (entity.kind === "hero") {
    return {
      ...entity,
      position: { ...entity.position },
      hp: { ...entity.hp },
      stamina: { ...entity.stamina },
      cards: {
        drawPile: entity.cards.drawPile.map((card) => ({ ...card })),
        hand: entity.cards.hand.map((card) => ({ ...card })),
        discard: entity.cards.discard.map((card) => ({ ...card })),
        excludedForMode: entity.cards.excludedForMode.map((card) => ({ ...card })),
        defenseSlot: entity.cards.defenseSlot ? { ...entity.cards.defenseSlot } : null,
        revision: entity.cards.revision,
        nextHandRotationAtTick: entity.cards.nextHandRotationAtTick,
      },
      protections: entity.protections.map((protection) => ({ ...protection })),
      statuses: entity.statuses.map(cloneStatusLayer),
    };
  }
  return {
    ...entity,
    position: { ...entity.position },
    hp: { ...entity.hp },
    statuses: entity.statuses.map(cloneStatusLayer),
  };
}

export function cloneActiveIntent(intent: ActiveIntent): ActiveIntent {
  return {
    ...intent,
    targetCell: intent.targetCell ? { ...intent.targetCell } : null,
    publicTargetCell: intent.publicTargetCell ? { ...intent.publicTargetCell } : null,
  };
}

function isRuntimeHandler(handler: string): boolean {
  return handler === "move_close" || handler === "melee_strike" || handler === "ranged_shot" ||
    handler === "hold_position" || handler === "bind" || handler === "ally_guard";
}

function cloneAndValidateStatusLayers(layers: readonly StatusLayer[], entityId: string): StatusLayer[] {
  const seenIds = new Set<string>();
  const seenStatusKeys = new Set<string>();
  return layers.map((layer) => {
    const expectedPotency = layer.templateKey === "immobilized"
      ? 1
      : layer.templateKey === "ally_guard"
        ? ALLY_GUARD_DEFENSE_BONUS_PERCENT
        : null;
    if (!layer.id || seenIds.has(layer.id) || expectedPotency === null || seenStatusKeys.has(layer.templateKey) ||
      layer.potency !== expectedPotency || !Number.isInteger(layer.stacks) || layer.stacks !== 1 ||
      !Number.isInteger(layer.appliedAtTick) || layer.appliedAtTick < 0 ||
      !Number.isInteger(layer.expiresAtTick) || layer.expiresAtTick <= layer.appliedAtTick ||
      layer.refreshPolicy !== "refresh_duration") {
      throw new Error(`Entity ${entityId} has an invalid status layer ${layer.id}`);
    }
    seenIds.add(layer.id);
    seenStatusKeys.add(layer.templateKey);
    return cloneStatusLayer(layer);
  });
}

function cloneStatusLayer(layer: StatusLayer): StatusLayer {
  return { ...layer };
}

function buildCardTemplateRegistry(templates: readonly CardTemplate[]): Map<string, CardTemplate> {
  const registry = new Map<string, CardTemplate>();
  for (const template of templates) {
    if (!template.key || registry.has(template.key)) throw new Error(`Duplicate or empty card template key: ${template.key}`);
    if (!Number.isInteger(template.version) || template.version < 1 ||
      !Number.isInteger(template.staminaCost) || template.staminaCost < 0 ||
      !Number.isInteger(template.range.minInclusive) || template.range.minInclusive < 0 ||
      !Number.isInteger(template.range.maxInclusive) || template.range.maxInclusive < template.range.minInclusive ||
      template.allowedModes.length === 0 ||
      template.allowedModes.some((mode) => !["movement", "melee", "ranged"].includes(mode)) ||
      new Set(template.allowedModes).size !== template.allowedModes.length ||
      !["required", "not_required"].includes(template.lineOfSight)) {
      throw new Error(`Invalid direct-damage card template ${template.key}`);
    }
    if ((template.effect.kind === "direct_damage" && (template.range.minInclusive < 1 || !Number.isFinite(template.effect.rawDamage) || template.effect.rawDamage <= 0 ||
      !Number.isFinite(template.effect.multiplier) || template.effect.multiplier <= 0)) ||
      (template.effect.kind === "damage_barrier" && (!Number.isInteger(template.effect.amount) || template.effect.amount <= 0))) {
      throw new Error(`Invalid card effect template ${template.key}`);
    }
    registry.set(template.key, cloneCardTemplate(template));
  }
  return registry;
}

function cloneAndValidateCardInstances(
  cards: readonly { instanceId: string; templateKey: string }[],
  templates: ReadonlyMap<string, CardTemplate>,
  seenInstances: Set<string>,
  heroId: string,
): { instanceId: string; templateKey: string }[] {
  return cards.map((card) => {
    if (!card.instanceId || seenInstances.has(card.instanceId) || !templates.has(card.templateKey)) {
      throw new Error(`Hero ${heroId} has a duplicate or invalid card instance ${card.instanceId}`);
    }
    seenInstances.add(card.instanceId);
    return { ...card };
  });
}

function cloneCardTemplate(template: CardTemplate): CardTemplate {
  return {
    ...template,
    allowedModes: [...template.allowedModes],
    range: { ...template.range },
    effect: { ...template.effect },
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
