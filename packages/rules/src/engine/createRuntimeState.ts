import { createGrid, cellIndex, isInBounds } from "../grid/Grid.js";
import { cloneIntentTemplate, buildEnemyRegistry, buildIntentRegistry } from "../intents/registry.js";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  type ActiveIntent,
  type EntityRuntime,
  type RuntimeState,
  type RuntimeSnapshot,
  type SimulationEngineConfig,
} from "./types.js";
import { assertRuntimeInvariants } from "./invariants.js";

export function createRuntimeState(config: SimulationEngineConfig): RuntimeState {
  const intentTemplates = buildIntentRegistry(config.intentTemplates);
  const enemyTemplates = buildEnemyRegistry(config.enemyTemplates, intentTemplates);
  const entities = new Map<string, EntityRuntime>();
  const cells = createGrid(config.terrain);
  const playerEntityIds: string[] = [];
  const enemyEntityIds: string[] = [];

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
        statuses: [...source.statuses],
        position: { ...source.position },
        activeIntentId: null,
      };
    } else {
      entity = {
        ...source,
        hp: { ...source.hp },
        statuses: [...source.statuses],
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
  for (const [actorId, heroId] of heroIdByActorId) {
    const hero = entities.get(heroId);
    if (!hero || hero.kind !== "hero" || hero.aliveState !== "active") {
      throw new Error(`Actor ${actorId} is mapped to a non-active hero ${heroId}`);
    }
  }

  const initialIntentEntries = config.initialIntentByEnemyId === undefined
    ? [...entities.values()]
      .filter((entity): entity is Extract<EntityRuntime, { kind: "enemy" }> => entity.kind === "enemy" && entity.aliveState === "active")
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
    if (!entity || entity.kind !== "enemy" || entity.aliveState !== "active" || !enemyTemplate || !intentTemplate) {
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

  const initialServerTick = config.initialServerTick ?? 0;
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
  return {
    ...entity,
    position: { ...entity.position },
    hp: { ...entity.hp },
    statuses: [...entity.statuses],
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
  return handler === "move_close" || handler === "melee_strike" || handler === "ranged_shot" || handler === "hold_position";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
