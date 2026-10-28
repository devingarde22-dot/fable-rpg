import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createVerticalSliceEngine,
  createVerticalSliceWebSocketServer,
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  PlayerGmVerticalSlice,
  type PlayerProjection,
  type SliceRole,
  type TvProjection,
  type WebSocketServerMessage,
} from "../src/index.js";
import type { DomainEvent, SimulationEngine } from "../../rules/src/index.js";

const campaignId = "campaign-visibility-matrix";
const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];

const auth = new InMemoryAuthProvider(new Map<string, { id: string; roles: readonly SliceRole[] }>([
  ["player-1-token", { id: "identity-player-1", roles: ["player"] }],
  ["player-2-token", { id: "identity-player-2", roles: ["player"] }],
  ["gm-token", { id: "identity-gm", roles: ["gm"] }],
  ["tv-token", { id: "identity-tv", roles: ["tv"] }],
]));

const membership = new InMemoryCampaignMembershipStore([
  { campaignId, identityId: "identity-player-1", role: "player", actorId: "player-1" },
  { campaignId, identityId: "identity-player-2", role: "player", actorId: "player-2" },
  { campaignId, identityId: "identity-gm", role: "gm" },
  { campaignId, identityId: "identity-tv", role: "tv" },
]);

function createTestServer(slice?: PlayerGmVerticalSlice) {
  const server = createVerticalSliceWebSocketServer({
    campaignId,
    auth,
    membership,
    ...(slice ? { slice } : {}),
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

function nextMessages(socket: WebSocket, count: number): Promise<WebSocketServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: WebSocketServerMessage[] = [];
    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(data.toString()) as WebSocketServerMessage);
      if (messages.length >= count) {
        socket.off("error", onError);
        socket.off("message", onMessage);
        resolve(messages);
      }
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function openClient(server: ReturnType<typeof createVerticalSliceWebSocketServer>): Promise<WebSocket> {
  if (!server.httpServer.listening) await server.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Expected ephemeral TCP port");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

async function closeClient(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

function fixtureSliceWithAuditedEvents(eventsToInject: readonly DomainEvent[]): PlayerGmVerticalSlice {
  const base = createVerticalSliceEngine();
  let injected = false;
  const engine = new Proxy(base, {
    get(target, property, receiver) {
      if (property === "events") return () => [...target.events(), ...(injected ? eventsToInject : [])];
      if (property === "advanceTicks") return (count: number) => {
        const result = target.advanceTicks(count);
        injected = true;
        return result;
      };
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as SimulationEngine;
  return new PlayerGmVerticalSlice(engine);
}

describe("Visibility Matrix & Role Projections (Stage 7)", () => {
  describe("Negative Test 1: Player isolation", () => {
    it("ensures Player 1 cannot see Player 2's hand, defense slot, or stamina in projection", () => {
      const slice = new PlayerGmVerticalSlice();
      const p1 = slice.connect("player", "session-p1", "player-1");
      const p2 = slice.connect("player", "session-p2", "player-2");

      const p1Proj = p1.projection() as PlayerProjection;
      const p2Proj = p2.projection() as PlayerProjection;

      expect(p1Proj.projection).toBe("player");
      expect(p1Proj.subjectPlayerId).toBe("player-1");
      expect(p1Proj.stamina).toEqual({ current: 3, max: 3 });
      expect(Array.isArray(p1Proj.hand)).toBe(true);
      expect(p1Proj.defenseSlot).toBeNull();

      expect(p2Proj.projection).toBe("player");
      expect(p2Proj.subjectPlayerId).toBe("player-2");
      expect(p2Proj.stamina).toEqual({ current: 3, max: 3 });

      // Player 1 projection entities must not include Player 2's hero
      const p1EntityIds = p1Proj.entities.map((e) => e.id);
      expect(p1EntityIds).toContain("hero-1");
      expect(p1EntityIds).not.toContain("hero-2");

      // Verify no field in Player 1 projection leaks hero-2 or player-2 resources
      const p1Serialized = JSON.stringify(p1Proj);
      expect(p1Serialized).not.toContain("hero-2");
      expect(p1Serialized).not.toContain("player-2");
    });

    it("ensures Player 1 does not receive private card/stamina/deck events of Player 2", () => {
      const foreignEvents: DomainEvent[] = [
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "p2-stamina-changed",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 2,
          serverTick: 10,
          serverSequence: 201,
          eventGroupId: "grp-p2",
          eventIndex: 0,
          causedByRequestId: "req-p2-card",
          actorId: "player-2",
          replay: null,
          eventType: "stamina.changed",
          payload: { heroId: "hero-2", current: 1, maximum: 3, reason: "card_cost" },
        },
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "p2-card-drawn",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 2,
          serverTick: 10,
          serverSequence: 202,
          eventGroupId: "grp-p2",
          eventIndex: 1,
          causedByRequestId: "req-p2-card",
          actorId: "player-2",
          replay: null,
          eventType: "card.drawn",
          payload: { heroId: "hero-2", cardInstanceId: "secret-card-instance-p2", destination: "hand", reason: "timer_rotation", cardRevision: 1 },
        },
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "p2-card-discarded",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 2,
          serverTick: 10,
          serverSequence: 203,
          eventGroupId: "grp-p2",
          eventIndex: 2,
          causedByRequestId: "req-p2-card",
          actorId: "player-2",
          replay: null,
          eventType: "card.discarded",
          payload: { heroId: "hero-2", cardInstanceId: "secret-card-instance-p2-old", reason: "played", discardRevision: 1 },
        },
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "p2-deck-shuffled",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 2,
          serverTick: 10,
          serverSequence: 204,
          eventGroupId: "grp-p2",
          eventIndex: 3,
          causedByRequestId: "req-p2-card",
          actorId: "player-2",
          replay: { seedRef: "secret-shuffle-seed" },
          eventType: "deck.shuffled",
          payload: {
            heroId: "hero-2",
            mode: "melee",
            reason: "mode_entry",
            sourceCardInstanceIds: ["c1", "c2"],
            eligibleCardInstanceIds: ["c1", "c2"],
            excludedCardInstanceIds: [],
            orderedCardInstanceIds: ["c2", "c1"],
            operationId: "op-1",
            cardRevision: 2,
          },
        },
      ];

      const slice = fixtureSliceWithAuditedEvents(foreignEvents);
      const p1 = slice.connect("player", "session-p1", "player-1");
      const gm = slice.connect("gm", "session-gm");
      p1.drain();
      gm.drain();

      // Trigger movement to trigger advanceTicks and event broadcast
      const p1Messages = p1.send({ kind: "player.move", requestId: "p1-move", direction: "right" });
      const gmMessages = gm.drain();

      const p1EventsMessage = p1Messages.find((m) => m.type === "events");
      const gmEventsMessage = gmMessages.find((m) => m.type === "events");

      expect(p1EventsMessage?.type).toBe("events");
      expect(gmEventsMessage?.type).toBe("events");

      if (p1EventsMessage?.type !== "events" || gmEventsMessage?.type !== "events") {
        throw new Error("Expected events on both connections");
      }

      // Player 1 must NOT receive any of Player 2's private events
      expect(p1EventsMessage.events.some((e) => e.eventId === "p2-stamina-changed")).toBe(false);
      expect(p1EventsMessage.events.some((e) => e.eventId === "p2-card-drawn")).toBe(false);
      expect(p1EventsMessage.events.some((e) => e.eventId === "p2-card-discarded")).toBe(false);
      expect(p1EventsMessage.events.some((e) => e.eventId === "p2-deck-shuffled")).toBe(false);

      // Verify Player 1 received events do not contain any private card strings
      const p1EventsJson = JSON.stringify(p1EventsMessage.events);
      expect(p1EventsJson).not.toContain("secret-card-instance-p2");
      expect(p1EventsJson).not.toContain("secret-shuffle-seed");

      // GM, on the other hand, receives all raw events
      expect(gmEventsMessage.events.some((e) => e.eventId === "p2-stamina-changed")).toBe(true);
      expect(gmEventsMessage.events.some((e) => e.eventId === "p2-card-drawn")).toBe(true);
      expect(gmEventsMessage.events.some((e) => e.eventId === "p2-card-discarded")).toBe(true);
      expect(gmEventsMessage.events.some((e) => e.eventId === "p2-deck-shuffled")).toBe(true);
    });
  });

  describe("Negative Test 2: TV projection and event isolation", () => {
    it("ensures TV projection has grid/obstacles/entities/telegraph and strictly excludes cards, stamina, and seeds", () => {
      const slice = new PlayerGmVerticalSlice();
      const tv = slice.connect("tv", "session-tv");
      const tvProj = tv.projection() as TvProjection;

      expect(tvProj.projection).toBe("tv");
      expect(tvProj.availableCommands).toEqual([]);

      // Grid and obstacles
      expect(tvProj.grid).toEqual({ width: 9, height: 9 });
      expect(tvProj.terrain.length).toBeGreaterThan(0);
      expect(tvProj.terrain).toContainEqual({ cell: { x: 4, y: 2 }, terrain: "wall" });
      expect(tvProj.terrain).toContainEqual({ cell: { x: 4, y: 3 }, terrain: "wall" });
      expect(tvProj.blockedCells).toContainEqual({ x: 4, y: 2 });
      expect(tvProj.blockedCells).toContainEqual({ x: 4, y: 3 });

      // Entities visible to TV (all public entities: heroes and enemies)
      expect(tvProj.entities.map((e) => e.id).sort()).toEqual(["enemy-chaser", "hero-1", "hero-2"]);
      for (const entity of tvProj.entities) {
        expect(entity).toHaveProperty("position");
        expect(entity).toHaveProperty("hp");
        expect(entity).toHaveProperty("aliveState");
        expect(entity).not.toHaveProperty("cards");
        expect(entity).not.toHaveProperty("stamina");
        expect(entity).not.toHaveProperty("defenseSlot");
      }

      // Active intents telegraph
      expect(tvProj.activeIntents).toHaveLength(1);
      const telegraph = tvProj.activeIntents[0];
      if (!telegraph) throw new Error("Expected active intent telegraph");
      expect(telegraph.enemyId).toBe("enemy-chaser");
      expect(telegraph).toHaveProperty("icon");
      expect(telegraph).toHaveProperty("timer");
      expect(telegraph.timer.durationMs).toBeGreaterThan(0);

      // STRICTLY EXCLUDED: TV must not have cards, stamina, defense slot, targetId, seed, or GM audit
      expect(tvProj).not.toHaveProperty("hand");
      expect(tvProj).not.toHaveProperty("defenseSlot");
      expect(tvProj).not.toHaveProperty("stamina");
      expect(tvProj).not.toHaveProperty("drawPile");
      expect(tvProj).not.toHaveProperty("discard");

      expect(telegraph).not.toHaveProperty("targetEntityId");
      expect(telegraph).not.toHaveProperty("seedRef");
      expect(telegraph).not.toHaveProperty("selectionPolicy");
      expect(telegraph).not.toHaveProperty("rawDamage");

      const tvSerialized = JSON.stringify(tvProj);
      expect(tvSerialized).not.toContain("seedRef");
      expect(tvSerialized).not.toContain("drawPile");
      expect(tvSerialized).not.toContain("defenseSlot");
    });

    it("ensures TV does not receive secret target selection, RNG seed, damage formulas, or checkpoint ids in events", () => {
      const auditEvents: DomainEvent[] = [
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "secret-target-selection",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 3,
          serverTick: 15,
          serverSequence: 301,
          eventGroupId: "grp-audit",
          eventIndex: 0,
          causedByRequestId: null,
          actorId: null,
          replay: { seedRef: "tv-forbidden-intent-seed" },
          eventType: "intent.target_selected",
          payload: {
            activeIntentId: "intent-chaser-1",
            enemyId: "enemy-chaser",
            targetEntityId: "hero-1",
            targetCell: { x: 1, y: 2 },
            selectionPolicy: "nearest_player",
            tieBreak: "seeded_random",
            seedRef: "tv-forbidden-intent-seed",
          },
        },
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "secret-hp-change",
          eventVersion: 2,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 3,
          serverTick: 15,
          serverSequence: 302,
          eventGroupId: "grp-audit",
          eventIndex: 1,
          causedByRequestId: null,
          actorId: null,
          replay: { seedRef: "tv-forbidden-damage-seed" },
          eventType: "hp.changed",
          payload: {
            entityId: "hero-1",
            current: 980,
            maximum: 1000,
            kind: "damage",
            publicAmount: 20,
            source: { kind: "enemy_intent", enemyId: "enemy-chaser", activeIntentId: "intent-chaser-1", handler: "melee_strike" },
            formulaVersion: "fable.damage.v1",
            rawDamage: 35,
            defense: 20,
            multiplier: 0.5,
            finalDamage: 20,
          },
        },
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "secret-checkpoint",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 3,
          serverTick: 15,
          serverSequence: 303,
          eventGroupId: "grp-audit",
          eventIndex: 2,
          causedByRequestId: null,
          actorId: null,
          replay: null,
          eventType: "checkpoint.created",
          payload: { checkpointId: "secret-checkpoint-uuid-42", label: "Quarantine start", snapshotSchemaVersion: 1 },
        },
        {
          protocolVersion: "fable.protocol.v1",
          schemaVersion: 1,
          eventId: "rollback-event",
          eventVersion: 1,
          campaignId,
          sessionId: null,
          sceneId: "quarantine-gates",
          sceneRevision: 4,
          serverTick: 16,
          serverSequence: 304,
          eventGroupId: "grp-audit",
          eventIndex: 3,
          causedByRequestId: null,
          actorId: null,
          replay: null,
          eventType: "rollback.applied",
          payload: { checkpointId: "secret-checkpoint-uuid-42", previousRevision: 3, targetRevision: 1, restoredRevision: 1 },
        },
      ];

      const slice = fixtureSliceWithAuditedEvents(auditEvents);
      const tv = slice.connect("tv", "session-tv");
      const player = slice.connect("player", "session-p1", "player-1");
      const gm = slice.connect("gm", "session-gm");
      tv.drain();
      player.drain();
      gm.drain();

      player.send({ kind: "player.move", requestId: "p1-move-trigger", direction: "right" });
      const tvMessages = tv.drain();
      const tvEventsMessage = tvMessages.find((m) => m.type === "events");
      expect(tvEventsMessage?.type).toBe("events");
      if (tvEventsMessage?.type !== "events") throw new Error("Expected events on TV connection");

      // TV must not receive intent.target_selected
      expect(tvEventsMessage.events.some((e) => e.eventType === "intent.target_selected")).toBe(false);

      // TV must not receive checkpoint.created
      expect(tvEventsMessage.events.some((e) => e.eventType === "checkpoint.created")).toBe(false);

      // TV receives hp.changed, but sanitized: no replay seed, no actorId, no damage formula, no rawDamage
      const tvHpEvent = tvEventsMessage.events.find((e) => e.eventId === "secret-hp-change");
      expect(tvHpEvent).toBeDefined();
      if (!tvHpEvent) throw new Error("Expected hp.changed event for TV");
      expect(tvHpEvent.replay).toBeNull();
      expect(tvHpEvent.actorId).toBeNull();
      expect("source" in tvHpEvent.payload).toBe(false);
      expect("formulaVersion" in tvHpEvent.payload).toBe(false);
      expect("rawDamage" in tvHpEvent.payload).toBe(false);
      expect("finalDamage" in tvHpEvent.payload).toBe(false);
      expect("defense" in tvHpEvent.payload).toBe(false);
      if (tvHpEvent.eventType === "hp.changed") expect(tvHpEvent.payload.publicAmount).toBe(20);

      // TV receives rollback.applied without the secret checkpointId
      const tvRollback = tvEventsMessage.events.find((e) => e.eventId === "rollback-event");
      expect(tvRollback).toBeDefined();
      if (!tvRollback) throw new Error("Expected rollback.applied event for TV");
      expect("checkpointId" in tvRollback.payload).toBe(false);
      expect(tvRollback.payload).toEqual({ restoredRevision: 1 });

      // Entire TV payload must not contain forbidden seed strings or checkpoint id
      const tvSerialized = JSON.stringify(tvEventsMessage.events);
      expect(tvSerialized).not.toContain("tv-forbidden-intent-seed");
      expect(tvSerialized).not.toContain("tv-forbidden-damage-seed");
      expect(tvSerialized).not.toContain("secret-checkpoint-uuid-42");
    });
  });

  describe("Negative Test 3: Reconnect privilege escalation prevention", () => {
    it("ensures reconnect via resumeToken cannot elevate a player to GM", async () => {
      const server = createTestServer();
      const playerSocket = await openClient(server);
      let resumeToken = "";

      try {
        const initialPromise = nextMessages(playerSocket, 2);
        playerSocket.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "player",
          token: "player-1-token",
          actorId: "player-1",
        }));
        const initial = await initialPromise;
        const ready = initial.find((m) => m.type === "room.ready");
        if (ready?.type !== "room.ready" || !ready.resumeToken) throw new Error("Expected player room.ready with resumeToken");
        resumeToken = ready.resumeToken;
      } finally {
        await closeClient(playerSocket);
      }

      // Attacker uses Player 1's resumeToken attempting to connect as "gm"
      const attackerSocket = await openClient(server);
      try {
        const rejectPromise = nextMessages(attackerSocket, 1);
        attackerSocket.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "gm",
          token: "gm-token",
          resumeToken,
        }));
        const [rejectMsg] = await rejectPromise;
        expect(rejectMsg?.type).toBe("transport.error");
        if (rejectMsg?.type === "transport.error") {
          expect(rejectMsg.reason).toBe("resume_not_authorized");
        }
      } finally {
        await closeClient(attackerSocket);
      }

      // Attacker uses Player 1's resumeToken attempting to connect as "tv"
      const tvAttackerSocket = await openClient(server);
      try {
        const rejectPromise = nextMessages(tvAttackerSocket, 1);
        tvAttackerSocket.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "tv",
          token: "tv-token",
          resumeToken,
        }));
        const [rejectMsg] = await rejectPromise;
        expect(rejectMsg?.type).toBe("transport.error");
        if (rejectMsg?.type === "transport.error") {
          expect(rejectMsg.reason).toBe("resume_not_authorized");
        }
      } finally {
        await closeClient(tvAttackerSocket);
      }

      // Legitimate Player 1 reconnects: projection must remain "player", never "gm"
      const legitSocket = await openClient(server);
      try {
        const reconnectPromise = nextMessages(legitSocket, 2);
        legitSocket.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "player",
          token: "player-1-token",
          actorId: "player-1",
          resumeToken,
        }));
        const reconnectMessages = await reconnectPromise;
        const projectionMsg = reconnectMessages.find((m) => m.type === "projection");
        expect(projectionMsg?.type).toBe("projection");
        if (projectionMsg?.type === "projection") {
          expect(projectionMsg.projection.projection).toBe("player");
          expect("activeIntents" in projectionMsg.projection).toBe(false);
          expect(projectionMsg.projection.availableCommands).toEqual(["player.move"]);
        }
      } finally {
        await closeClient(legitSocket);
      }
    });

    it("ensures reconnect via resumeToken cannot elevate TV to Player or GM", async () => {
      const server = createTestServer();
      const tvSocket = await openClient(server);
      let tvResumeToken = "";

      try {
        const initialPromise = nextMessages(tvSocket, 2);
        tvSocket.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "tv",
          token: "tv-token",
        }));
        const initial = await initialPromise;
        const ready = initial.find((m) => m.type === "room.ready");
        if (ready?.type !== "room.ready" || !ready.resumeToken) throw new Error("Expected TV room.ready with resumeToken");
        tvResumeToken = ready.resumeToken;
      } finally {
        await closeClient(tvSocket);
      }

      // Try reconnecting as player with TV's resumeToken
      const elevatedSocket = await openClient(server);
      try {
        const rejectPromise = nextMessages(elevatedSocket, 1);
        elevatedSocket.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "player",
          token: "player-1-token",
          actorId: "player-1",
          resumeToken: tvResumeToken,
        }));
        const [rejectMsg] = await rejectPromise;
        expect(rejectMsg?.type).toBe("transport.error");
        if (rejectMsg?.type === "transport.error") {
          expect(rejectMsg.reason).toBe("resume_not_authorized");
        }
      } finally {
        await closeClient(elevatedSocket);
      }
    });
  });

  describe("Negative Test 4: Command rejections and validation errors do not leak hidden data", () => {
    it("rejects unauthorized commands for TV without exposing state, RNG, or GM internals", () => {
      const slice = new PlayerGmVerticalSlice();
      const tv = slice.connect("tv", "session-tv");
      tv.drain();

      // TV sends player.move
      const moveResponses = tv.send({ kind: "player.move", requestId: "tv-move-attack", direction: "up" });
      expect(moveResponses).toEqual([
        { type: "command.result", requestId: "tv-move-attack", result: { status: "rejected", reason: "player_role_required" } },
      ]);

      // TV sends gm.pause
      const pauseResponses = tv.send({ kind: "gm.pause", requestId: "tv-pause-attack", paused: true });
      expect(pauseResponses).toEqual([
        { type: "command.result", requestId: "tv-pause-attack", result: { status: "rejected", reason: "gm_role_required" } },
      ]);

      // TV sends gm.end_expedition
      const endResponses = tv.send({ kind: "gm.end_expedition", requestId: "tv-end-attack", outcome: "defeat", reason: "unauthorized" });
      expect(endResponses).toEqual([
        { type: "command.result", requestId: "tv-end-attack", result: { status: "rejected", reason: "gm_role_required" } },
      ]);
    });

    it("rejects unauthorized GM commands from player without leaking GM outcome details", () => {
      const slice = new PlayerGmVerticalSlice();
      const player = slice.connect("player", "session-p1", "player-1");
      player.drain();

      const pauseResponses = player.send({ kind: "gm.pause", requestId: "p1-unauth-pause", paused: true });
      expect(pauseResponses).toEqual([
        { type: "command.result", requestId: "p1-unauth-pause", result: { status: "rejected", reason: "gm_role_required" } },
      ]);

      const endResponses = player.send({ kind: "gm.end_expedition", requestId: "p1-unauth-end", outcome: "success", reason: "hack" });
      expect(endResponses).toEqual([
        { type: "command.result", requestId: "p1-unauth-end", result: { status: "rejected", reason: "gm_role_required" } },
      ]);
    });

    it("does not reflect injected secret parameters in schema validation error message", async () => {
      const server = createTestServer();
      const client = await openClient(server);

      try {
        const readyPromise = nextMessages(client, 2);
        client.send(JSON.stringify({
          type: "hello",
          campaignId,
          role: "player",
          token: "player-1-token",
          actorId: "player-1",
        }));
        await readyPromise;

        const secretPayload = "TOP_SECRET_INTERNAL_KEY_987654";
        const rejectPromise = nextMessages(client, 1);
        client.send(JSON.stringify({
          type: "command",
          command: {
            kind: "player.move",
            requestId: "req-with-secret",
            direction: "left",
            injectedSecret: secretPayload,
          },
        }));

        const [rejectMsg] = await rejectPromise;
        expect(rejectMsg?.type).toBe("transport.error");
        if (rejectMsg?.type === "transport.error") {
          expect(rejectMsg.reason).toContain("schema_validation_failed");
          // Crucial check: the secret key value must NOT be echoed back in the error message!
          expect(rejectMsg.reason).not.toContain(secretPayload);
        }
      } finally {
        await closeClient(client);
      }
    });
  });
});
