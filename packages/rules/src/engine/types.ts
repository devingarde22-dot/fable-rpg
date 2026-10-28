export const GRID_WIDTH = 9 as const;
export const GRID_HEIGHT = 9 as const;
export const TICK_RATE = 20 as const;
export const TICK_DURATION_MS = 50 as const;
export const INPUT_WINDOW_TICKS = 5 as const;
export const RNG_ALGORITHM_VERSION = "fable.rng.v1" as const;
export const DAMAGE_FORMULA_VERSION = "fable.damage.v1" as const;
export const STAMINA_REGEN_INTERVAL_TICKS = 300 as const;
export const INITIAL_STAMINA = 3 as const;

export type EntityId = string;
export type Cell = { x: number; y: number };
export type Direction = "up" | "down" | "left" | "right";
export type Terrain = "floor" | "wall" | "statue";
export type RuntimeEntityKind = "hero" | "enemy";
export type RuntimeFaction = "party" | "enemy" | "neutral";
export type AliveState = "active" | "unconscious" | "critically_injured" | "removed";
export type CampaignOutcome = "success" | "retreat" | "defeat" | "gm_abort";
export type ResourceValue = { current: number; max: number };
export type StaminaRuntime = ResourceValue & { nextRegenAtTick: number | null };
export type HeroMode = "movement" | "melee" | "ranged";
export type ModeChangedValue = "out_of_combat" | HeroMode;
export type StatusTemplateKey = "immobilized" | "ally_guard";
export type StatusRefreshPolicy = "refresh_duration" | "add_duration" | "diminishing_potency" | "replace";
export type StatusLayer = {
  id: string;
  templateKey: StatusTemplateKey;
  sourceEntityId: EntityId | null;
  potency: number;
  stacks: number;
  appliedAtTick: number;
  expiresAtTick: number;
  refreshPolicy: StatusRefreshPolicy;
};
export const IMMOBILIZED_DURATION_MS = 15_000 as const;
export const IMMOBILIZED_DURATION_TICKS = IMMOBILIZED_DURATION_MS / TICK_DURATION_MS;
export const ALLY_GUARD_DURATION_MS = 15_000 as const;
export const ALLY_GUARD_DURATION_TICKS = ALLY_GUARD_DURATION_MS / TICK_DURATION_MS;
export const ALLY_GUARD_DEFENSE_BONUS_PERCENT = 20 as const;
export type CardEffect =
  | { kind: "direct_damage"; rawDamage: number; multiplier: number }
  | { kind: "prevent_one_attack" }
  | { kind: "damage_barrier"; amount: number }
  | { kind: "apply_ally_guard" };
export type CardTemplate = {
  key: string;
  version: number;
  allowedModes: readonly HeroMode[];
  staminaCost: number;
  range: { minInclusive: number; maxInclusive: number };
  lineOfSight: "required" | "not_required";
  effect: CardEffect;
};
export type CardInstance = { instanceId: string; templateKey: string };
export type ProtectionRuntime =
  | { id: string; kind: "prevent_one_attack"; sourceCardInstanceId: string }
  | { id: string; kind: "damage_barrier"; sourceCardInstanceId: string; remainingAmount: number };
export const CARD_HAND_LIMIT = 5 as const;
export const CARD_ROTATION_INTERVAL_TICKS = 300 as const;
export type HeroCardsRuntime = {
  drawPile: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  excludedForMode: CardInstance[];
  defenseSlot: CardInstance | null;
  revision: number;
  nextHandRotationAtTick: number | null;
};

export type TargetPolicy =
  | "none"
  | "nearest_player"
  | "current_target"
  | "highest_threat"
  | "nearest_visible_player"
  | "lowest_ally_hp_percentage";

export type IntentPrecondition = "target_available" | "path_exists" | "melee_contact";
export type IntentEffect =
  | { handler: "move_close"; parameters: Record<string, never> }
  | { handler: "melee_strike"; parameters: { rawDamage: number } }
  | { handler: "ranged_shot"; parameters: { rawDamage: number } }
  | { handler: "reposition"; parameters: Record<string, never> }
  | { handler: "hold_position"; parameters: Record<string, never> }
  | { handler: "bind"; parameters: { statusKey: "immobilized"; durationMs: number } }
  | { handler: "ally_guard"; parameters: { defenseBonusPercent: number; durationMs: number } };

export type IntentTemplate = {
  kind: "intent_template";
  key: string;
  version: number;
  status: "draft" | "confirmed" | "deprecated";
  icon: string;
  durationMs: number;
  conditions: { preconditions: readonly IntentPrecondition[] };
  effect: IntentEffect;
  targetRules: {
    policy: TargetPolicy;
    fallbackPolicies: readonly TargetPolicy[];
    range: null | { minInclusive: number; maxInclusive: number };
    lineOfSight: "required" | "not_required";
    filters: {
      factions: readonly RuntimeFaction[];
      aliveStates: readonly AliveState[];
      requiredStatuses: readonly string[];
      excludedStatuses: readonly string[];
    };
  };
  fallbackKeys: readonly string[];
  visibility: "public" | "conditional" | "gm_only";
  revealPolicy?: { visibility: "conditional"; revealKey: string; revealEventType: string };
};

export type EnemyTemplate = {
  kind: "enemy_template";
  key: string;
  version: number;
  status: "draft" | "confirmed" | "deprecated";
  hp: number;
  defense: number;
  basicAttack: { handler: "melee_strike"; rawDamage: number };
  role: string;
  intentKeys: readonly string[];
  initialIntentKey?: string;
};

export type CellRuntime = {
  x: number;
  y: number;
  terrain: Terrain;
  blocksMovement: boolean;
  blocksLineOfSight: boolean;
  occupantId: EntityId | null;
};

type RuntimeEntityBase = {
  id: EntityId;
  position: Cell;
  aliveState: AliveState;
  hp: ResourceValue;
  defense: number;
  threat: number;
  statuses: StatusLayer[];
};

export type HeroRuntime = RuntimeEntityBase & {
  kind: "hero";
  faction: "party";
  stamina: StaminaRuntime;
  cards: HeroCardsRuntime;
  protections: ProtectionRuntime[];
  mode: HeroMode | null;
  canEnterRangedMode: boolean;
  activeIntentId: null;
  templateKey?: string;
};

export type EnemyRuntime = RuntimeEntityBase & {
  kind: "enemy";
  faction: "enemy";
  mode: null;
  templateKey: string;
  activeIntentId: string | null;
};

export type EntityRuntime = HeroRuntime | EnemyRuntime;

export type ActiveIntent = {
  activeIntentId: string;
  ownerEntityId: EntityId;
  templateKey: string;
  state: "started" | "telegraphed" | "resolving" | "resolved" | "cancelled";
  startedAtTick: number;
  resolvesAtTick: number;
  targetEntityId: EntityId | null;
  targetCell: Cell | null;
  publicTargetCell: Cell | null;
  selectionPolicy: TargetPolicy;
  seedRef: string | null;
  cancelReason: IntentCancelReason | null;
};

export type IntentCancelReason =
  | "target_invalid"
  | "path_blocked"
  | "los_blocked"
  | "state_locked"
  | "no_longer_possible"
  | "owner_removed"
  | "no_valid_fallback";

export type RngPurpose = "target_selection" | "fallback_selection" | "deck_shuffle" | "retreat_attack_order";
export type RngState = readonly [number, number, number, number];
export type RngForkInput = {
  rootSeed: string;
  campaignId: string;
  sceneId: string;
  serverTick: number;
  activeIntentId: string;
  purpose: RngPurpose;
};
export type RngAuditRecord = {
  algorithmVersion: typeof RNG_ALGORITHM_VERSION;
  forkInput: RngForkInput;
  seedRef: string;
  rngStateBefore: RngState;
  rngStateAfter: RngState;
};

export type DamageSource =
  | { kind: "enemy_intent"; enemyId: EntityId; activeIntentId: string; handler: "melee_strike" | "ranged_shot" }
  | { kind: "retreat_attack"; enemyId: EntityId; attackOrder: number }
  | { kind: "card"; heroId: EntityId; cardInstanceId: string; cardTemplateKey: string };

export type InternalPlayerMoveCommand = {
  requestId: string;
  sessionId: string;
  actorId: string;
  role: "player";
  command: "player.move";
  payload: { direction: Direction };
  clientRevision: number;
  serverReceiveSequence: number;
};
export type InternalModeCommand = {
  requestId: string;
  sessionId: string;
  actorId: string;
  role: "player";
  command: "player.enter_movement_mode" | "player.enter_ranged_mode";
  payload: Record<string, never>;
  clientRevision: number;
  serverReceiveSequence: number;
};
export type InternalPlayCardCommand = {
  requestId: string;
  sessionId: string;
  actorId: string;
  role: "player";
  command: "player.play_card";
  payload: {
    cardInstanceId: string;
    targetEntityId?: EntityId;
    targetCell?: Cell;
    mode: HeroMode;
    clientCardRevision: number;
  };
  clientRevision: number;
  serverReceiveSequence: number;
};
export type InternalCommand = InternalPlayerMoveCommand | InternalModeCommand | InternalPlayCardCommand;

export type InputWindowRuntime = { windowId: number; commands: InternalCommand[] };
export type SceneRuntime = {
  id: string;
  width: typeof GRID_WIDTH;
  height: typeof GRID_HEIGHT;
  cells: CellRuntime[];
  playerEntityIds: EntityId[];
  enemyEntityIds: EntityId[];
  inputWindow: InputWindowRuntime;
  startedAtTick: number;
  contactImmunityUntilTick: Map<EntityId, number>;
};

export type RuntimeState = {
  campaignId: string;
  sessionId: string;
  scene: SceneRuntime;
  entities: Map<EntityId, EntityRuntime>;
  activeIntents: Map<string, ActiveIntent>;
  cardTemplates: Map<string, CardTemplate>;
  enemyTemplates: Map<string, EnemyTemplate>;
  intentTemplates: Map<string, IntentTemplate>;
  initialIntentByEnemyId: Map<string, string>;
  heroIdByActorId: Map<string, EntityId>;
  serverTick: number;
  sceneRevision: number;
  nextServerSequence: number;
  rootSeed: string;
  phase: "loading" | "active" | "ended";
  paused: false;
  outcome: CampaignOutcome | null;
};

type EventBase = {
  protocolVersion: "fable.protocol.v1";
  schemaVersion: 1;
  eventId: string;
  eventVersion: 1;
  campaignId: string;
  sessionId: string | null;
  sceneId: string | null;
  sceneRevision: number;
  serverTick: number;
  serverSequence: number;
  eventGroupId: string;
  eventIndex: number;
  causedByRequestId: string | null;
  actorId: string | null;
  replay: { seedRef: string } | null;
};

type EventBaseV2 = Omit<EventBase, "eventVersion"> & { eventVersion: 2 };

export type DomainEvent =
  | (EventBase & { eventType: "scene.entity_moved"; payload: { entityId: EntityId; from: Cell; to: Cell } })
  | (EventBase & {
      eventType: "card.played";
      payload: { heroId: EntityId; cardInstanceId: string; mode: HeroMode; staminaCost: number; targetEntityId: EntityId; targetCell: Cell };
    })
  | (EventBase & {
      eventType: "card.effect_applied";
      payload: {
        heroId: EntityId; cardInstanceId: string; targetEntityId: EntityId; effect: CardEffect;
        protectionId?: string; amount?: number; statusLayer?: { layerId: string; potency: number; expiresAtTick: number };
      };
    })
  | (EventBase & {
      eventType: "protection.applied";
      payload: { heroId: EntityId; protectionId: string; kind: "prevent_one_attack" | "damage_barrier"; sourceCardInstanceId: string; amount: number };
    })
  | (EventBase & {
      eventType: "protection.triggered";
      payload: {
        heroId: EntityId; protectionId: string; kind: "prevent_one_attack" | "damage_barrier";
        source: Exclude<DamageSource, { kind: "card" }>; incomingDamage: number; absorbedDamage: number; remainingDamage: number; remainingAmount: number;
      };
    })
  | (EventBase & {
      eventType: "protection.expired";
      payload: { heroId: EntityId; protectionId: string; kind: "prevent_one_attack" | "damage_barrier"; reason: "barrier_depleted" | "battle_ended" };
    })
  | (EventBase & {
      eventType: "card.discarded";
      payload: { heroId: EntityId; cardInstanceId: string; reason: "played" | "timer_rotation"; discardRevision: number };
    })
  | (EventBase & {
      eventType: "card.drawn";
      payload: { heroId: EntityId; cardInstanceId: string; destination: "hand"; reason: "mode_entry" | "timer_rotation"; cardRevision: number };
    })
  | (EventBase & {
      eventType: "deck.shuffled";
      payload: {
        heroId: EntityId;
        mode: Exclude<HeroMode, "movement">;
        reason: "mode_entry" | "discard_exhausted";
        sourceCardInstanceIds: string[];
        eligibleCardInstanceIds: string[];
        excludedCardInstanceIds: string[];
        orderedCardInstanceIds: string[];
        operationId: string;
        cardRevision: number;
      };
    })
  | (EventBase & {
      eventType: "deck.rotation_resolved";
      payload: {
        heroId: EntityId;
        dueAtTick: number;
        nextHandRotationAtTick: number;
        discardedCardInstanceId: string | null;
        drawnCardInstanceId: string | null;
        cardRevision: number;
      };
    })
  | (EventBase & {
      eventType: "mode.changed";
      payload: { heroId: EntityId; from: ModeChangedValue; to: ModeChangedValue; reason: "command" | "contact" | "retreat" | "scene_end" | "rollback" };
    })
  | (EventBase & {
      eventType: "stamina.changed";
      payload: { heroId: EntityId; current: number; maximum: number; reason: "card_cost" | "regeneration" };
    })
  | (EventBase & {
      eventType: "status.applied";
      payload: {
        entityId: EntityId;
        statusKey: StatusTemplateKey;
        layerId: string;
        timer: { startedAtTick: number; resolvesAtTick: number; durationMs: number; remainingMs: number; paused: false };
        publicPotency: number;
      };
    })
  | (EventBase & {
      eventType: "status.refreshed";
      payload: {
        entityId: EntityId;
        statusKey: StatusTemplateKey;
        layerId: string;
        timer: { startedAtTick: number; resolvesAtTick: number; durationMs: number; remainingMs: number; paused: false };
        publicPotency: number;
      };
    })
  | (EventBase & {
      eventType: "status.expired";
      payload: { entityId: EntityId; statusKey: StatusTemplateKey; layerId: string };
    })
  | (EventBase & {
      eventType: "intent.started";
      payload: {
        enemyId: EntityId;
        templateKey: string;
        activeIntentId: string;
        timer: { startedAtTick: number; resolvesAtTick: number; durationMs: number; remainingMs: number; paused: false };
        icon: string;
        publicTargetCell?: Cell;
      };
    })
  | (EventBase & {
      eventType: "intent.target_selected";
      payload: {
        activeIntentId: string;
        enemyId: EntityId;
        targetEntityId: EntityId;
        targetCell: Cell;
        selectionPolicy: Exclude<TargetPolicy, "none">;
        tieBreak: "seeded_random" | "single_candidate";
        seedRef: string;
      };
    })
  | (EventBase & {
      eventType: "intent.cancelled";
      payload: { enemyId: EntityId; activeIntentId: string; reason: IntentCancelReason };
    })
  | (EventBase & {
      eventType: "intent.resolved";
      payload: { enemyId: EntityId; activeIntentId: string; effectKey: string; targetEntityId?: EntityId };
    })
  | (EventBase & {
      eventType: "hp.changed";
      payload: { entityId: EntityId; current: number; maximum: number; kind: "damage" | "heal" | "direct_set" | "rollback"; publicAmount?: number };
    })
  | (EventBaseV2 & {
      eventType: "hp.changed";
      payload: {
        entityId: EntityId;
        current: number;
        maximum: number;
        kind: "damage";
        publicAmount?: number;
        source: DamageSource;
        formulaVersion: typeof DAMAGE_FORMULA_VERSION;
        rawDamage: number;
        defense: number;
        multiplier: number;
        finalDamage: number;
        absorbedAmount?: number;
      };
    })
  | (EventBase & {
      eventType: "checkpoint.created";
      payload: { checkpointId: string; label: string; snapshotSchemaVersion: 1 };
    })
  | (EventBase & {
      eventType: "rollback.applied";
      payload: { checkpointId: string; previousRevision: number; targetRevision: number; restoredRevision: number };
    })
  | (EventBase & {
      eventType: "campaign.outcome_confirmed";
      payload: { outcome: CampaignOutcome; rewardUnlocked: boolean; reason?: string };
    })
  | (EventBase & {
      eventType: "scene.entity_removed";
      payload: { entityId: EntityId; reason: "hp_depleted"; cell: Cell };
    });

export type JournalRecord =
  | { kind: "event"; event: DomainEvent; rngAudit: readonly RngAuditRecord[] }
  | { kind: "tick"; serverTick: number; sceneRevision: number; inputWindow: InputWindowRuntime }
  | { kind: "input_window"; serverTick: number; inputWindow: InputWindowRuntime };

export type RuntimeSnapshot = {
  campaignId: string;
  sessionId: string;
  scene: SceneRuntime;
  entities: EntityRuntime[];
  activeIntents: ActiveIntent[];
  heroIdByActorId: Array<[string, EntityId]>;
  serverTick: number;
  sceneRevision: number;
  nextServerSequence: number;
  rootSeed: string;
  phase: "loading" | "active" | "ended";
  paused: false;
  outcome: CampaignOutcome | null;
};

export type EngineErrorCode =
  | "SCHEMA_INVALID"
  | "AUTH_FORBIDDEN"
  | "STALE_SCENE_REVISION"
  | "DUPLICATE_REQUEST"
  | "STATE_LOCKED"
  | "INVALID_MODE"
  | "CARD_NOT_AVAILABLE"
  | "CARD_MODE_MISMATCH"
  | "STALE_CARD_REVISION"
  | "INSUFFICIENT_STAMINA"
  | "TARGET_NOT_VISIBLE"
  | "TARGET_OUT_OF_RANGE"
  | "LINE_OF_SIGHT_BLOCKED"
  | "ENTITY_UNABLE_TO_ACT"
  | "CELL_OUT_OF_BOUNDS"
  | "CELL_BLOCKED"
  | "CELL_OCCUPIED"
  | "CONFLICTING_BATCH_STATE"
  | "INVALID_STATE";

export type InitialSubmitResult =
  | { status: "queued"; requestId: string; windowId: number }
  | { status: "rejected"; requestId: string; code: EngineErrorCode; sceneRevision: number };
export type FinalCommandResult =
  | { requestId: string; status: "accepted"; eventIds: string[]; sceneRevision: number }
  | { requestId: string; status: "rejected"; code: EngineErrorCode; sceneRevision: number };
export type CachedCommandResult = InitialSubmitResult | FinalCommandResult;
export type SubmitResult = InitialSubmitResult
  | { status: "duplicate"; requestId: string; original: CachedCommandResult };
export type TickResult = {
  serverTick: number;
  closedWindowId: number | null;
  events: readonly DomainEvent[];
  commandResults: readonly FinalCommandResult[];
  sceneRevision: number;
  stateHash: string;
};

export type SimulationEngineConfig = {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  rootSeed: string;
  cardTemplates?: readonly CardTemplate[];
  terrain?: readonly { cell: Cell; terrain: Terrain }[];
  entities: readonly EntityRuntime[];
  enemyTemplates: readonly EnemyTemplate[];
  intentTemplates: readonly IntentTemplate[];
  initialIntentByEnemyId?: Readonly<Record<string, string>>;
  heroIdByActorId: Readonly<Record<string, EntityId>>;
  initialServerTick?: number;
  initialSceneRevision?: number;
  initialServerSequence?: number;
};
