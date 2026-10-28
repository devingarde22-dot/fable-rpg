import { CONTENT_VERSION, ENEMY_TEMPLATES, INTENT_TEMPLATES } from "../../content/src/index.js";
import {
  createSimulationEngine,
  type Cell,
  type Direction,
  type DomainEvent,
  type EntityRuntime,
  type InternalCommand,
  type RuntimeSnapshot,
  type SimulationEngine,
  type SubmitResult,
} from "../../rules/src/index.js";

export type SliceRole = "gm" | "player";
export type SliceCommand =
  | { kind: "player.move"; requestId: string; direction: Direction; clientRevision?: number }
  | { kind: "gm.pause"; requestId: string; paused: boolean }
  | { kind: "gm.end_expedition"; requestId: string; outcome: "success" | "retreat" | "defeat" | "gm_abort"; reason: string };

type PublicEntity = {
  id: string;
  kind: EntityRuntime["kind"];
  position: Cell;
  hp: { current: number; max: number };
  aliveState: EntityRuntime["aliveState"];
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
};

export type GmProjection = Omit<PlayerProjection, "projection" | "subjectPlayerId" | "availableCommands"> & {
  projection: "gm";
  entities: PublicEntity[];
  activeIntents: RuntimeSnapshot["activeIntents"];
  outcome: RuntimeSnapshot["outcome"];
  availableCommands: readonly ["player.move", "gm.pause", "gm.end_expedition"];
};

export type SliceMessage =
  | { type: "room.ready"; role: SliceRole; sessionId: string }
  | { type: "projection"; projection: PlayerProjection | GmProjection }
  | { type: "events"; events: readonly DomainEvent[] }
  | { type: "command.result"; requestId: string; result: SubmitResult | { status: "accepted"; sceneRevision: number } | { status: "rejected"; reason: string } };

export type SliceConnection = {
  readonly role: SliceRole;
  readonly sessionId: string;
  readonly actorId: string | null;
  send(command: SliceCommand): SliceMessage[];
  projection(): PlayerProjection | GmProjection;
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
  private paused = false;

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

  projectionFor(sessionId: string): PlayerProjection | GmProjection {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const snapshot = this.engine.snapshot();
    const subjectHeroId = snapshot.heroIdByActorId.find(([actor]) => actor === session.actorId)?.[1];
    const entities = snapshot.entities.filter((entity) => session.role === "gm" || entity.kind === "enemy" || entity.id === subjectHeroId).map(publicEntity);
    const base = {
      protocolVersion: "fable.protocol.v1" as const,
      campaignId: snapshot.campaignId,
      sessionId,
      sceneId: snapshot.scene.id,
      sceneRevision: snapshot.sceneRevision,
      serverTick: snapshot.serverTick,
      timePaused: this.paused,
      rulesetVersion: "fable.ruleset.0.1" as const,
      contentVersion: CONTENT_VERSION,
      entities,
    };
    if (session.role === "gm") return {
      ...base,
      projection: "gm" as const,
      activeIntents: snapshot.activeIntents,
      outcome: snapshot.outcome,
      availableCommands: ["player.move", "gm.pause", "gm.end_expedition"] as const,
    };
    return {
      ...base,
      projection: "player" as const,
      subjectPlayerId: session.actorId ?? "",
      availableCommands: ["player.move"] as const,
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
      this.paused = command.paused;
      this.broadcast({ type: "projection", projection: this.projectionFor(sessionId) });
      this.broadcast({ type: "command.result", requestId: command.requestId, result: { status: "accepted", sceneRevision: this.engine.snapshot().sceneRevision } });
      return this.drainOnly(session);
    }
    if (command.kind === "gm.end_expedition") {
      if (session.role !== "gm") return this.reject(session, command.requestId, "gm_role_required");
      const result = this.engine.confirmOutcome(command.outcome, command.reason);
      this.broadcastEvents(beforeEvents);
      this.broadcast({ type: "projection", projection: this.projectionFor(sessionId) });
      this.broadcast({ type: "command.result", requestId: command.requestId, result: { status: "accepted", sceneRevision: result.snapshot.sceneRevision } });
      return this.drainOnly(session);
    }
    if (session.role !== "player" || !session.actorId) return this.reject(session, command.requestId, "player_role_required");
    if (this.paused) return this.reject(session, command.requestId, "scene_paused");
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
    if (events.length > 0) this.broadcast({ type: "events", events });
  }

  private broadcastAllProjections(): void {
    for (const [sessionId] of this.sessions) this.broadcast({ type: "projection", projection: this.projectionFor(sessionId) });
  }

  private broadcast(message: SliceMessage): void {
    for (const session of this.sessions.values()) session.outbox.push(message);
  }

  private drainOnly(session: Session): SliceMessage[] {
    return session.outbox.splice(0);
  }
}

export { createVerticalSliceWebSocketServer } from "./websocket.js";
export type {
  VerticalSliceWebSocketServer,
  WebSocketClientMessage,
  WebSocketCommand,
  WebSocketHello,
  WebSocketServerMessage,
} from "./websocket.js";
