import { CONTENT_VERSION, ENEMY_TEMPLATES, INTENT_TEMPLATES } from "../../content/src/index.js";
import {
  createSimulationEngine,
  type CardInstance,
  type Cell,
  type Direction,
  type DomainEvent,
  type EntityRuntime,
  type HeroRuntime,
  type InternalCommand,
  type RuntimeSnapshot,
  type SimulationEngine,
  type StatusLayer,
  type SubmitResult,
  type Terrain,
} from "../../rules/src/index.js";

export type SliceRole = "gm" | "player" | "tv";
export type SliceCommand =
  | { kind: "player.move"; requestId: string; direction: Direction; clientRevision?: number }
  | { kind: "gm.pause"; requestId: string; paused: boolean }
  | { kind: "gm.end_expedition"; requestId: string; outcome: "success" | "retreat" | "defeat" | "gm_abort"; reason: string };

export type PublicEntity = {
  id: string;
  kind: EntityRuntime["kind"];
  position: Cell;
  hp: { current: number; max: number };
  aliveState: EntityRuntime["aliveState"];
};

export type TvIntentTelegraph = {
  enemyId: string;
  activeIntentId: string;
  icon: string;
  timer: {
    startedAtTick: number;
    resolvesAtTick: number;
    durationMs: number;
    remainingMs: number;
  };
  targetCell: Cell | null;
  publicTargetCell?: Cell | null;
};

export type TvProjection = {
  protocolVersion: "fable.protocol.v1";
  projection: "tv";
  campaignId: string;
  sessionId: string;
  sceneId: string;
  sceneRevision: number;
  serverTick: number;
  timePaused: boolean;
  rulesetVersion: "fable.ruleset.0.1";
  contentVersion: typeof CONTENT_VERSION;
  grid: {
    width: number;
    height: number;
  };
  terrain: Array<{ cell: Cell; terrain: Terrain }>;
  blockedCells: Cell[];
  entities: PublicEntity[];
  activeIntents: TvIntentTelegraph[];
  availableCommands: readonly [];
};

export type PlayerProjection = {
  protocolVersion: "fable.protocol.v1";
  projection: "player";
  campaignId: string;
  sessionId: string;
  sceneId: string;
  sceneRevision: number;
  serverTick: number;
  timePaused: boolean;
  rulesetVersion: "fable.ruleset.0.1";
  contentVersion: typeof CONTENT_VERSION;
  subjectPlayerId: string;
  entities: PublicEntity[];
  availableCommands: readonly ["player.move"];
  hand: readonly CardInstance[];
  defenseSlot: CardInstance | null;
  stamina: { current: number; max: number };
  statuses: readonly StatusLayer[];
};

export type GmProjection = {
  protocolVersion: "fable.protocol.v1";
  projection: "gm";
  campaignId: string;
  sessionId: string;
  sceneId: string;
  sceneRevision: number;
  serverTick: number;
  timePaused: boolean;
  rulesetVersion: "fable.ruleset.0.1";
  contentVersion: typeof CONTENT_VERSION;
  entities: PublicEntity[];
  activeIntents: RuntimeSnapshot["activeIntents"];
  outcome: RuntimeSnapshot["outcome"];
  availableCommands: readonly ["player.move", "gm.pause", "gm.end_expedition"];
};

export type PlayerDomainEvent = Omit<DomainEvent, "actorId" | "payload" | "replay"> & {
  actorId: null;
  payload: Record<string, unknown>;
  replay: null;
};
export type ProjectedDomainEvent = DomainEvent | PlayerDomainEvent;

export type SliceMessage =
  | { type: "room.ready"; role: SliceRole; sessionId: string; campaignId?: string; resumeToken?: string }
  | { type: "projection"; projection: PlayerProjection | GmProjection | TvProjection }
  | { type: "events"; events: readonly ProjectedDomainEvent[] }
  | { type: "command.result"; requestId: string; result: SubmitResult | { status: "accepted"; sceneRevision: number } | { status: "rejected"; reason: string } };

export type SliceConnection = {
  readonly role: SliceRole;
  readonly sessionId: string;
  readonly actorId: string | null;
  send(command: SliceCommand): SliceMessage[];
  projection(): PlayerProjection | GmProjection | TvProjection;
  drain(): SliceMessage[];
};

type Session = { role: SliceRole; actorId: string | null; outbox: SliceMessage[] };

function hero(id: string, position: Cell): EntityRuntime {
  return {
    id,
    kind: "hero",
    faction: "party",
    position,
    aliveState: "active",
    hp: { current: 1_000, max: 1_000 },
    stamina: { current: 3, max: 3, nextRegenAtTick: null },
    cards: { drawPile: [], hand: [], discard: [], excludedForMode: [], defenseSlot: null, revision: 0, nextHandRotationAtTick: null },
    protections: [],
    defense: 20,
    threat: 0,
    statuses: [],
    mode: "movement",
    canEnterRangedMode: false,
    activeIntentId: null,
  };
}

function enemy(id: string, position: Cell): EntityRuntime {
  const template = ENEMY_TEMPLATES.find((candidate) => candidate.key === "quarantine_chaser");
  if (!template) throw new Error("quarantine_chaser content is unavailable");
  return {
    id,
    kind: "enemy",
    faction: "enemy",
    templateKey: template.key,
    position,
    aliveState: "active",
    hp: { current: template.hp, max: template.hp },
    defense: template.defense,
    threat: 0,
    statuses: [],
    mode: null,
    activeIntentId: null,
  };
}

export function createVerticalSliceEngine(): SimulationEngine {
  const enemyTemplates = ENEMY_TEMPLATES.filter((template) => template.key === "quarantine_chaser");
  const intentTemplates = INTENT_TEMPLATES.filter((template) => ["move_close", "melee_strike", "hold_position"].includes(template.key));
  return createSimulationEngine({
    campaignId: "campaign-vertical-slice",
    sessionId: "session-vertical-slice",
    sceneId: "quarantine-gates",
    rootSeed: "vertical-slice-seed-v1",
    entities: [hero("hero-1", { x: 1, y: 2 }), hero("hero-2", { x: 1, y: 3 }), enemy("enemy-chaser", { x: 7, y: 7 })],
    enemyTemplates,
    intentTemplates,
    initialIntentByEnemyId: { "enemy-chaser": "move_close" },
    heroIdByActorId: { "player-1": "hero-1", "player-2": "hero-2" },
    terrain: [
      { cell: { x: 4, y: 2 }, terrain: "wall" },
      { cell: { x: 4, y: 3 }, terrain: "wall" },
    ],
  });
}

function publicEntity(entity: EntityRuntime): PublicEntity {
  return { id: entity.id, kind: entity.kind, position: { ...entity.position }, hp: { ...entity.hp }, aliveState: entity.aliveState };
}

export class PlayerGmVerticalSlice {
  readonly engine: SimulationEngine;
  private readonly sessions = new Map<string, Session>();

  constructor(engine = createVerticalSliceEngine()) {
    this.engine = engine;
  }

  connect(role: SliceRole, sessionId: string, actorId?: string): SliceConnection {
    if (!sessionId.trim()) throw new Error("sessionId must not be empty");
    if (this.sessions.has(sessionId)) throw new Error(`Session ${sessionId} is already connected`);
    if (role === "player" && (!actorId || !this.engine.snapshot().heroIdByActorId.some(([candidate]) => candidate === actorId))) {
      throw new Error("A player must connect with a known actorId");
    }
    if (role === "gm" && this.sessionsAs("gm").length > 0) throw new Error("Only one GM can connect");
    const session: Session = { role, actorId: actorId ?? null, outbox: [{ type: "room.ready", role, sessionId }] };
    this.sessions.set(sessionId, session);
    session.outbox.push({ type: "projection", projection: this.projectionFor(sessionId) });
    return this.connection(sessionId);
  }

  disconnect(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  projectionFor(sessionId: string): PlayerProjection | GmProjection | TvProjection {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const snapshot = this.engine.snapshot();
    const subjectHeroId = snapshot.heroIdByActorId.find(([actor]) => actor === session.actorId)?.[1];
    const base = {
      protocolVersion: "fable.protocol.v1" as const,
      campaignId: snapshot.campaignId,
      sessionId,
      sceneId: snapshot.scene.id,
      sceneRevision: snapshot.sceneRevision,
      serverTick: snapshot.serverTick,
      timePaused: snapshot.paused,
      rulesetVersion: "fable.ruleset.0.1" as const,
      contentVersion: CONTENT_VERSION,
    };
    if (session.role === "gm") {
      return {
        ...base,
        projection: "gm" as const,
        entities: snapshot.entities.map(publicEntity),
        activeIntents: snapshot.activeIntents,
        outcome: snapshot.outcome,
        availableCommands: ["player.move", "gm.pause", "gm.end_expedition"] as const,
      };
    }
    if (session.role === "tv") {
      const terrain = snapshot.scene.cells
        .filter((cell) => cell.terrain !== "floor" || cell.blocksMovement)
        .map((cell) => ({ cell: { x: cell.x, y: cell.y }, terrain: cell.terrain }));
      const blockedCells = snapshot.scene.cells
        .filter((cell) => cell.blocksMovement)
        .map((cell) => ({ x: cell.x, y: cell.y }));
      const activeIntents: TvIntentTelegraph[] = snapshot.activeIntents.map((intent) => {
        const template = INTENT_TEMPLATES.find((t) => t.key === intent.templateKey);
        const icon = template?.icon ?? "attack";
        const durationMs = template?.durationMs ?? 0;
        const remainingTicks = Math.max(0, intent.resolvesAtTick - snapshot.serverTick);
        const remainingMs = remainingTicks * 50;
        return {
          enemyId: intent.ownerEntityId,
          activeIntentId: intent.activeIntentId,
          icon,
          timer: {
            startedAtTick: intent.startedAtTick,
            resolvesAtTick: intent.resolvesAtTick,
            durationMs,
            remainingMs,
          },
          targetCell: intent.publicTargetCell ? { ...intent.publicTargetCell } : null,
          ...(intent.publicTargetCell ? { publicTargetCell: { ...intent.publicTargetCell } } : {}),
        };
      });
      return {
        ...base,
        projection: "tv" as const,
        grid: {
          width: snapshot.scene.width,
          height: snapshot.scene.height,
        },
        terrain,
        blockedCells,
        entities: snapshot.entities.map(publicEntity),
        activeIntents,
        availableCommands: [] as const,
      };
    }
    const entities = snapshot.entities
      .filter((entity) => entity.kind === "enemy" || entity.id === subjectHeroId)
      .map(publicEntity);
    const subjectHero = snapshot.entities.find(
      (entity): entity is HeroRuntime => entity.id === subjectHeroId && entity.kind === "hero",
    );
    return {
      ...base,
      projection: "player" as const,
      subjectPlayerId: session.actorId ?? "",
      entities,
      availableCommands: ["player.move"] as const,
      hand: subjectHero ? subjectHero.cards.hand.map((c) => ({ ...c })) : [],
      defenseSlot: subjectHero?.cards.defenseSlot ? { ...subjectHero.cards.defenseSlot } : null,
      stamina: subjectHero ? { current: subjectHero.stamina.current, max: subjectHero.stamina.max } : { current: 0, max: 0 },
      statuses: subjectHero ? subjectHero.statuses.map((s) => ({ ...s })) : [],
    };
  }

  private sessionsAs(role: SliceRole): Session[] {
    return [...this.sessions.values()].filter((session) => session.role === role);
  }

  private connection(sessionId: string): SliceConnection {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return {
      role: session.role,
      sessionId,
      actorId: session.actorId,
      send: (command) => this.handle(sessionId, command),
      projection: () => this.projectionFor(sessionId),
      drain: () => {
        const messages = session.outbox.splice(0);
        return messages;
      },
    };
  }

  private handle(sessionId: string, command: SliceCommand): SliceMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const beforeEvents = this.engine.events().length;
    if (command.kind === "gm.pause") {
      if (session.role !== "gm") return this.reject(session, command.requestId, "gm_role_required");
      this.engine.setPaused(command.paused);
      this.broadcastAllProjections();
      this.broadcast({ type: "command.result", requestId: command.requestId, result: { status: "accepted", sceneRevision: this.engine.snapshot().sceneRevision } });
      return this.drainOnly(session);
    }
    if (command.kind === "gm.end_expedition") {
      if (session.role !== "gm") return this.reject(session, command.requestId, "gm_role_required");
      const result = this.engine.confirmOutcome(command.outcome, command.reason);
      this.broadcastEvents(beforeEvents);
      this.broadcastAllProjections();
      this.broadcast({ type: "command.result", requestId: command.requestId, result: { status: "accepted", sceneRevision: result.snapshot.sceneRevision } });
      return this.drainOnly(session);
    }
    if (session.role !== "player" || !session.actorId) return this.reject(session, command.requestId, "player_role_required");
    if (this.engine.snapshot().paused) return this.reject(session, command.requestId, "scene_paused");
    const internal: InternalCommand = {
      requestId: command.requestId,
      sessionId: this.engine.state.sessionId,
      actorId: session.actorId,
      role: "player",
      command: "player.move",
      payload: { direction: command.direction },
      clientRevision: command.clientRevision ?? this.engine.snapshot().sceneRevision,
      serverReceiveSequence: this.engine.snapshot().nextServerSequence,
    };
    const submitted = this.engine.submit(internal);
    const tick = submitted.status === "queued" ? this.engine.advanceTicks(5).at(-1) : undefined;
    this.broadcastEvents(beforeEvents);
    this.broadcastAllProjections();
    this.broadcast({ type: "command.result", requestId: command.requestId, result: tick?.commandResults[0] ?? submitted });
    return this.drainOnly(session);
  }

  private reject(session: Session, requestId: string, reason: string): SliceMessage[] {
    session.outbox.push({ type: "command.result", requestId, result: { status: "rejected", reason } });
    return this.drainOnly(session);
  }

  private broadcastEvents(beforeEvents: number): void {
    const events = this.engine.events().slice(beforeEvents);
    if (events.length === 0) return;
    const snapshot = this.engine.snapshot();
    for (const session of this.sessions.values()) {
      const projected = session.role === "gm"
        ? events
        : session.role === "tv"
          ? events
              .map((event) => projectEventForTv(event, snapshot))
              .filter((event): event is PlayerDomainEvent => event !== null)
          : events
              .map((event) => projectEventForPlayer(event, snapshot, session.actorId))
              .filter((event): event is PlayerDomainEvent => event !== null);
      if (projected.length > 0) session.outbox.push({ type: "events", events: projected });
    }
  }

  private broadcastAllProjections(): void {
    for (const [sessionId, session] of this.sessions) {
      session.outbox.push({ type: "projection", projection: this.projectionFor(sessionId) });
    }
  }

  private broadcast(message: SliceMessage): void {
    for (const session of this.sessions.values()) session.outbox.push(message);
  }

  private drainOnly(session: Session): SliceMessage[] {
    return session.outbox.splice(0);
  }
}

function projectEventForPlayer(event: DomainEvent, snapshot: RuntimeSnapshot, actorId: string | null): PlayerDomainEvent | null {
  const subjectHeroId = snapshot.heroIdByActorId.find(([candidate]) => candidate === actorId)?.[1] ?? null;
  const publicEntity = (entityId: string): boolean => snapshot.entities.some((entity) => entity.id === entityId && (entity.kind === "enemy" || entity.id === subjectHeroId));
  const ownerEvent = (heroId: string): boolean => heroId === subjectHeroId;
  const redact = (payload: Record<string, unknown>): PlayerDomainEvent => ({ ...event, actorId: null, replay: null, payload });

  switch (event.eventType) {
    case "scene.entity_moved":
      return publicEntity(event.payload.entityId) ? redact(event.payload) : null;
    case "card.played":
      if (ownerEvent(event.payload.heroId)) return redact(event.payload);
      return publicEntity(event.payload.targetEntityId)
        ? redact({ heroId: event.payload.heroId, mode: event.payload.mode, targetCell: event.payload.targetCell })
        : null;
    case "card.effect_applied":
    case "protection.applied":
    case "protection.triggered":
    case "protection.expired":
    case "card.drawn":
    case "card.discarded":
    case "deck.shuffled":
    case "deck.rotation_resolved":
    case "mode.changed":
    case "stamina.changed":
      return ownerEvent(event.payload.heroId) ? redact(event.payload) : null;
    case "status.applied":
    case "status.refreshed":
    case "status.expired":
      return publicEntity(event.payload.entityId) ? redact(event.payload) : null;
    case "intent.started":
      return publicEntity(event.payload.enemyId) ? redact({
        enemyId: event.payload.enemyId,
        activeIntentId: event.payload.activeIntentId,
        timer: event.payload.timer,
        icon: event.payload.icon,
        ...(event.payload.publicTargetCell ? { publicTargetCell: event.payload.publicTargetCell } : {}),
      }) : null;
    case "intent.cancelled":
      return publicEntity(event.payload.enemyId) ? redact({ enemyId: event.payload.enemyId, activeIntentId: event.payload.activeIntentId }) : null;
    case "intent.resolved":
      return publicEntity(event.payload.enemyId) ? redact({ enemyId: event.payload.enemyId, activeIntentId: event.payload.activeIntentId }) : null;
    case "intent.target_selected":
      return null;
    case "hp.changed": {
      if (!publicEntity(event.payload.entityId)) return null;
      const payload = {
        entityId: event.payload.entityId,
        current: event.payload.current,
        maximum: event.payload.maximum,
        kind: event.payload.kind,
        ...(event.payload.publicAmount === undefined ? {} : { publicAmount: event.payload.publicAmount }),
      };
      return redact(payload);
    }
    case "checkpoint.created":
      return null;
    case "rollback.applied":
      return redact({ restoredRevision: event.payload.restoredRevision });
    case "campaign.outcome_confirmed":
      return redact({ outcome: event.payload.outcome, rewardUnlocked: event.payload.rewardUnlocked });
    case "scene.entity_removed":
      return publicEntity(event.payload.entityId) ? redact(event.payload) : null;
    default:
      return null;
  }
}

function projectEventForTv(event: DomainEvent, snapshot: RuntimeSnapshot): PlayerDomainEvent | null {
  const isPublicEntity = (entityId: string): boolean => snapshot.entities.some((entity) => entity.id === entityId);
  const redact = (payload: Record<string, unknown>): PlayerDomainEvent => ({ ...event, actorId: null, replay: null, payload });

  switch (event.eventType) {
    case "scene.entity_moved":
      return isPublicEntity(event.payload.entityId) ? redact(event.payload) : null;
    case "card.played":
      return isPublicEntity(event.payload.heroId) || isPublicEntity(event.payload.targetEntityId)
        ? redact({ heroId: event.payload.heroId, mode: event.payload.mode, targetCell: event.payload.targetCell })
        : null;
    case "card.effect_applied":
    case "protection.applied":
    case "protection.triggered":
    case "protection.expired":
    case "card.drawn":
    case "card.discarded":
    case "deck.shuffled":
    case "deck.rotation_resolved":
    case "mode.changed":
    case "stamina.changed":
      return null;
    case "status.applied":
    case "status.refreshed":
    case "status.expired":
      return isPublicEntity(event.payload.entityId) ? redact(event.payload) : null;
    case "intent.started":
      return isPublicEntity(event.payload.enemyId) ? redact({
        enemyId: event.payload.enemyId,
        activeIntentId: event.payload.activeIntentId,
        timer: event.payload.timer,
        icon: event.payload.icon,
        ...(event.payload.publicTargetCell ? { publicTargetCell: event.payload.publicTargetCell } : {}),
      }) : null;
    case "intent.cancelled":
      return isPublicEntity(event.payload.enemyId) ? redact({ enemyId: event.payload.enemyId, activeIntentId: event.payload.activeIntentId }) : null;
    case "intent.resolved":
      return isPublicEntity(event.payload.enemyId) ? redact({ enemyId: event.payload.enemyId, activeIntentId: event.payload.activeIntentId }) : null;
    case "intent.target_selected":
      return null;
    case "hp.changed": {
      if (!isPublicEntity(event.payload.entityId)) return null;
      const payload = {
        entityId: event.payload.entityId,
        current: event.payload.current,
        maximum: event.payload.maximum,
        kind: event.payload.kind,
        ...(event.payload.publicAmount === undefined ? {} : { publicAmount: event.payload.publicAmount }),
      };
      return redact(payload);
    }
    case "checkpoint.created":
      return null;
    case "rollback.applied":
      return redact({ restoredRevision: event.payload.restoredRevision });
    case "campaign.outcome_confirmed":
      return redact({ outcome: event.payload.outcome, rewardUnlocked: event.payload.rewardUnlocked });
    case "scene.entity_removed":
      return isPublicEntity(event.payload.entityId) ? redact(event.payload) : null;
    default:
      return null;
  }
}

export type AuthIdentity = { id: string; roles: readonly SliceRole[] };
export type AuthProvider = { authenticate(token: string): AuthIdentity | null | Promise<AuthIdentity | null> };
export type CampaignMembership = { campaignId: string; identityId: string; role: SliceRole; actorId?: string };
export type CampaignMembershipStore = { canJoin(identity: AuthIdentity, membership: { campaignId: string; role: SliceRole; actorId?: string }): boolean | Promise<boolean> };
export type ResumeSession = {
  resumeToken: string;
  campaignId: string;
  sessionId: string;
  identityId: string;
  role: SliceRole;
  actorId: string | null;
  updatedAt: number;
};

export class InMemoryAuthProvider implements AuthProvider {
  constructor(private readonly tokens: ReadonlyMap<string, AuthIdentity>) {}
  authenticate(token: string): AuthIdentity | null {
    return this.tokens.get(token) ?? null;
  }
}

export class InMemoryCampaignMembershipStore implements CampaignMembershipStore {
  constructor(private readonly memberships: readonly CampaignMembership[]) {}
  canJoin(identity: AuthIdentity, membership: { campaignId: string; role: SliceRole; actorId?: string }): boolean {
    return this.memberships.some(
      (candidate) =>
        candidate.campaignId === membership.campaignId &&
        candidate.identityId === identity.id &&
        candidate.role === membership.role &&
        (membership.actorId === undefined || candidate.actorId === membership.actorId),
    );
  }
}

export {
  createVerticalSliceWebSocketServer,
  createVerticalSliceWebSocketServerFromPersistence,
  createVerticalSliceRestoreConfig,
} from "./websocket.js";
export type {
  VerticalSliceWebSocketServer,
  WebSocketClientMessage,
  WebSocketCommand,
  WebSocketHello,
  WebSocketServerMessage,
  WebSocketErrorLog,
  WebSocketErrorLogger,
} from "./websocket.js";
export {
  InMemorySlicePersistence,
  TokenBucketRateLimiter,
} from "./security.js";
export type {
  SlicePersistence,
  CommandReceipt,
} from "./security.js";
export { SqliteSlicePersistence } from "./sqlitePersistence.js";
export type { VerticalSliceWebSocketOptions } from "./websocket.js";
