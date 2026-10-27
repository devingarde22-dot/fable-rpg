export const GRID_WIDTH = 9 as const;
export const GRID_HEIGHT = 9 as const;
export const TICK_RATE = 20 as const;
export const TICK_DURATION_MS = 50 as const;
export const INPUT_WINDOW_TICKS = 5 as const;
export const RNG_ALGORITHM_VERSION = "fable.rng.v1" as const;

export type EntityId = string;
export type Cell = { x: number; y: number };
export type Direction = "up" | "down" | "left" | "right";
export type Terrain = "floor" | "wall" | "statue";
export type RuntimeEntityKind = "hero" | "enemy";
export type RuntimeFaction = "party" | "enemy" | "neutral";
export type AliveState = "active" | "unconscious" | "critically_injured" | "removed";
export type ResourceValue = { current: number; max: number };
export type HeroMode = "movement" | "melee" | "ranged";
export type ModeChangedValue = "out_of_combat" | HeroMode;

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
  statuses: string[];
};

export type HeroRuntime = RuntimeEntityBase & {
  kind: "hero";
  faction: "party";
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
export type InternalCommand = InternalPlayerMoveCommand | InternalModeCommand;

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
  enemyTemplates: Map<string, EnemyTemplate>;
  intentTemplates: Map<string, IntentTemplate>;
  initialIntentByEnemyId: Map<string, string>;
  heroIdByActorId: Map<string, EntityId>;
  serverTick: number;
  sceneRevision: number;
  nextServerSequence: number;
  rootSeed: string;
  phase: "loading" | "active";
  paused: false;
  outcome: null;
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

export type DomainEvent =
  | (EventBase & { eventType: "scene.entity_moved"; payload: { entityId: EntityId; from: Cell; to: Cell } })
  | (EventBase & {
      eventType: "mode.changed";
      payload: { heroId: EntityId; from: ModeChangedValue; to: ModeChangedValue; reason: "command" | "contact" | "retreat" | "scene_end" | "rollback" };
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
  phase: "loading" | "active";
  paused: false;
  outcome: null;
};

export type EngineErrorCode =
  | "SCHEMA_INVALID"
  | "AUTH_FORBIDDEN"
  | "STALE_SCENE_REVISION"
  | "DUPLICATE_REQUEST"
  | "STATE_LOCKED"
  | "INVALID_MODE"
  | "CARD_NOT_AVAILABLE"
  | "CELL_OUT_OF_BOUNDS"
  | "CELL_BLOCKED"
  | "CELL_OCCUPIED"
  | "CONFLICTING_BATCH_STATE"
  | "INVALID_STATE";

export type SubmitResult =
  | { status: "queued"; requestId: string; windowId: number }
  | { status: "rejected"; requestId: string; code: EngineErrorCode; sceneRevision: number }
  | { status: "duplicate"; requestId: string; original: SubmitResult };
export type FinalCommandResult =
  | { requestId: string; status: "accepted"; eventIds: string[]; sceneRevision: number }
  | { requestId: string; status: "rejected"; code: EngineErrorCode; sceneRevision: number };
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
