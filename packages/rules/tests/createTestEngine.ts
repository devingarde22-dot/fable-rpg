import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type {
  EnemyTemplate,
  EntityRuntime,
  HeroCardsRuntime,
  IntentTemplate,
  RuntimeSnapshot,
  SimulationEngineConfig,
} from "../src/engine/types.js";
import { testCardTemplates } from "./fixtures/testCards.js";

const partyTargetFilters = {
  factions: ["party"] as const,
  aliveStates: ["active"] as const,
  requiredStatuses: [] as const,
  excludedStatuses: [] as const,
};

export const testIntentTemplates: readonly IntentTemplate[] = [
  {
    kind: "intent_template",
    key: "move_close",
    version: 1,
    status: "confirmed",
    icon: "move_close",
    durationMs: 15_000,
    conditions: { preconditions: ["target_available", "path_exists"] },
    effect: { handler: "move_close", parameters: {} },
    targetRules: {
      policy: "nearest_player",
      fallbackPolicies: [],
      range: null,
      lineOfSight: "not_required",
      filters: partyTargetFilters,
    },
    fallbackKeys: ["melee_strike", "hold_position"],
    visibility: "public",
  },
  {
    kind: "intent_template",
    key: "melee_strike",
    version: 1,
    status: "confirmed",
    icon: "melee_attack",
    durationMs: 6_000,
    conditions: { preconditions: ["target_available", "melee_contact"] },
    effect: { handler: "melee_strike", parameters: { rawDamage: 140 } },
    targetRules: {
      policy: "current_target",
      fallbackPolicies: ["nearest_player"],
      range: { minInclusive: 1, maxInclusive: 1 },
      lineOfSight: "not_required",
      filters: partyTargetFilters,
    },
    fallbackKeys: ["move_close", "hold_position"],
    visibility: "public",
  },
  {
    kind: "intent_template",
    key: "ranged_shot",
    version: 1,
    status: "confirmed",
    icon: "ranged_attack",
    durationMs: 10_000,
    conditions: { preconditions: ["target_available"] },
    effect: { handler: "ranged_shot", parameters: { rawDamage: 110 } },
    targetRules: {
      policy: "highest_threat",
      fallbackPolicies: ["nearest_visible_player"],
      range: { minInclusive: 2, maxInclusive: 7 },
      lineOfSight: "required",
      filters: partyTargetFilters,
    },
    fallbackKeys: ["hold_position"],
    visibility: "public",
  },
  {
    kind: "intent_template",
    key: "hold_position",
    version: 1,
    status: "confirmed",
    icon: "hold_position",
    durationMs: 15_000,
    conditions: { preconditions: [] },
    effect: { handler: "hold_position", parameters: {} },
    targetRules: {
      policy: "none",
      fallbackPolicies: [],
      range: null,
      lineOfSight: "not_required",
      filters: { factions: [], aliveStates: [], requiredStatuses: [], excludedStatuses: [] },
    },
    fallbackKeys: [],
    visibility: "public",
  },
];

export const testEnemyTemplates: readonly EnemyTemplate[] = [
  {
    kind: "enemy_template",
    key: "quarantine_chaser",
    version: 1,
    status: "confirmed",
    hp: 900,
    defense: 20,
    basicAttack: { handler: "melee_strike", rawDamage: 140 },
    role: "close_combat",
    intentKeys: ["move_close", "melee_strike", "hold_position"],
    initialIntentKey: "move_close",
  },
  {
    kind: "enemy_template",
    key: "slag_shooter",
    version: 1,
    status: "confirmed",
    hp: 350,
    defense: 12,
    basicAttack: { handler: "melee_strike", rawDamage: 100 },
    role: "ranged_attack",
    intentKeys: ["ranged_shot", "hold_position"],
    initialIntentKey: "ranged_shot",
  },
];

export function hero(
  id: string,
  x: number,
  y: number,
  mode: "movement" | "melee" | "ranged" | null = "movement",
  canEnterRangedMode = false,
  maxStamina = 3,
  cards: Partial<HeroCardsRuntime> = {},
): EntityRuntime {
  return {
    id,
    kind: "hero",
    faction: "party",
    position: { x, y },
    aliveState: "active",
    hp: { current: 1_000, max: 1_000 },
    stamina: { current: 3, max: maxStamina, nextRegenAtTick: null },
    cards: {
      drawPile: (cards.drawPile ?? []).map((card) => ({ ...card })),
      hand: (cards.hand ?? []).map((card) => ({ ...card })),
      discard: (cards.discard ?? []).map((card) => ({ ...card })),
      excludedForMode: (cards.excludedForMode ?? []).map((card) => ({ ...card })),
      revision: cards.revision ?? 0,
      nextHandRotationAtTick: cards.nextHandRotationAtTick ?? null,
    },
    defense: 20,
    threat: 0,
    statuses: [],
    mode,
    canEnterRangedMode,
    activeIntentId: null,
  };
}

export function enemy(id: string, x: number, y: number, templateKey = "quarantine_chaser"): EntityRuntime {
  const template = testEnemyTemplates.find((candidate) => candidate.key === templateKey);
  if (!template) throw new Error(`Unknown test enemy template ${templateKey}`);
  return {
    id,
    kind: "enemy",
    faction: "enemy",
    templateKey,
    position: { x, y },
    aliveState: "active",
    hp: { current: template.hp, max: template.hp },
    defense: template.defense,
    threat: 0,
    statuses: [],
    mode: null,
    activeIntentId: null,
  };
}

export function testConfig(overrides: Partial<SimulationEngineConfig> = {}): SimulationEngineConfig {
  return {
    campaignId: "campaign-test",
    sessionId: "session-test",
    sceneId: "scene-test",
    rootSeed: "fable-step-c-test",
    cardTemplates: testCardTemplates,
    entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 7)],
    enemyTemplates: testEnemyTemplates,
    intentTemplates: testIntentTemplates,
    initialIntentByEnemyId: {},
    heroIdByActorId: { "actor-1": "hero-1" },
    ...overrides,
  };
}

export function moveCommand(
  requestId: string,
  direction: "up" | "down" | "left" | "right",
  options: { actorId?: string; revision?: number; sequence?: number; sessionId?: string } = {},
) {
  return {
    requestId,
    sessionId: options.sessionId ?? "session-test",
    actorId: options.actorId ?? "actor-1",
    role: "player" as const,
    command: "player.move" as const,
    payload: { direction },
    clientRevision: options.revision ?? 0,
    serverReceiveSequence: options.sequence ?? 1,
  };
}

export function modeCommand(
  command: "player.enter_movement_mode" | "player.enter_ranged_mode",
  requestId: string,
  options: { actorId?: string; revision?: number; sequence?: number; sessionId?: string } = {},
) {
  return {
    requestId,
    sessionId: options.sessionId ?? "session-test",
    actorId: options.actorId ?? "actor-1",
    role: "player" as const,
    command,
    payload: {},
    clientRevision: options.revision ?? 0,
    serverReceiveSequence: options.sequence ?? 1,
  } as const;
}

export function playCardCommand(
  requestId: string,
  cardInstanceId: string,
  targetEntityId: string | undefined,
  mode: "movement" | "melee" | "ranged",
  options: { actorId?: string; revision?: number; cardRevision?: number; sequence?: number; sessionId?: string; targetCell?: { x: number; y: number } } = {},
) {
  const payload = {
    cardInstanceId,
    ...(targetEntityId === undefined ? {} : { targetEntityId }),
    ...(options.targetCell === undefined ? {} : { targetCell: { ...options.targetCell } }),
    mode,
    clientCardRevision: options.cardRevision ?? 0,
  };
  return {
    requestId,
    sessionId: options.sessionId ?? "session-test",
    actorId: options.actorId ?? "actor-1",
    role: "player" as const,
    command: "player.play_card" as const,
    payload,
    clientRevision: options.revision ?? 0,
    serverReceiveSequence: options.sequence ?? 1,
  } as const;
}

/** Gameplay projection excludes authoritative clock and window-inbox bookkeeping. */
export function gameplayState(snapshot: RuntimeSnapshot) {
  return {
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
    scene: {
      id: snapshot.scene.id,
      width: snapshot.scene.width,
      height: snapshot.scene.height,
      cells: snapshot.scene.cells,
      playerEntityIds: snapshot.scene.playerEntityIds,
      enemyEntityIds: snapshot.scene.enemyEntityIds,
      contactImmunityUntilTick: [...snapshot.scene.contactImmunityUntilTick].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      startedAtTick: snapshot.scene.startedAtTick,
    },
    entities: snapshot.entities,
    activeIntents: snapshot.activeIntents,
    heroIdByActorId: snapshot.heroIdByActorId,
    sceneRevision: snapshot.sceneRevision,
    rootSeed: snapshot.rootSeed,
    phase: snapshot.phase,
    paused: snapshot.paused,
    outcome: snapshot.outcome,
  };
}

export function makeEngine(overrides: Partial<SimulationEngineConfig> = {}) {
  return createSimulationEngine(testConfig(overrides));
}
