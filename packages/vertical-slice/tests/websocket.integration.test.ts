import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createVerticalSliceWebSocketServer,
  createVerticalSliceEngine,
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  PlayerGmVerticalSlice,
  type SliceRole,
  type WebSocketServerMessage,
} from "../src/index.js";
import type { DomainEvent, SimulationEngine } from "../../rules/src/index.js";

const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];
const campaignId = "campaign-vertical-slice";

function createServer(rateLimit?: { capacity?: number; refillPerSecond?: number }, slice?: PlayerGmVerticalSlice) {
  const options = {
    ...(slice ? { slice } : {}),
    auth: new InMemoryAuthProvider(new Map<string, { id: string; roles: readonly SliceRole[] }>([
      ["player-token", { id: "identity-player-1", roles: ["player"] }],
      ["gm-token", { id: "identity-gm", roles: ["gm"] }],
    ])),
    membership: new InMemoryCampaignMembershipStore([
      { campaignId, identityId: "identity-player-1", role: "player", actorId: "player-1" },
      { campaignId, identityId: "identity-gm", role: "gm" },
    ]),
    ...(rateLimit ? { rateLimit } : {}),
  };
  const server = createVerticalSliceWebSocketServer(options);
  servers.push(server);
  return server;
}

function visibilityFixtureSlice(): PlayerGmVerticalSlice {
  const base = createVerticalSliceEngine();
  let emitted = false;
  const hiddenTargetSelection = {
    protocolVersion: "fable.protocol.v1",
    schemaVersion: 1,
    eventId: "visibility-target-selection",
    eventVersion: 1,
    campaignId,
    sessionId: null,
    sceneId: "quarantine-gates",
    sceneRevision: 1,
    serverTick: 1,
    serverSequence: 100,
    eventGroupId: "visibility-group",
    eventIndex: 0,
    causedByRequestId: null,
    actorId: null,
    replay: { seedRef: "secret-target-seed" },
    eventType: "intent.target_selected",
    payload: {
      activeIntentId: "intent-secret",
      enemyId: "enemy-chaser",
      targetEntityId: "hero-2",
      targetCell: { x: 1, y: 3 },
      selectionPolicy: "nearest_player",
      tieBreak: "seeded_random",
      seedRef: "secret-target-seed",
    },
  } satisfies DomainEvent;
  const hiddenDamageDetails = {
    protocolVersion: "fable.protocol.v1",
    schemaVersion: 1,
    eventId: "visibility-hp-change",
    eventVersion: 2,
    campaignId,
    sessionId: null,
    sceneId: "quarantine-gates",
    sceneRevision: 1,
    serverTick: 1,
    serverSequence: 101,
    eventGroupId: "visibility-group",
    eventIndex: 1,
    causedByRequestId: null,
    actorId: null,
    replay: { seedRef: "secret-damage-seed" },
    eventType: "hp.changed",
    payload: {
      entityId: "enemy-chaser",
      current: 90,
      maximum: 100,
      kind: "damage",
      publicAmount: 10,
      source: { kind: "enemy_intent", enemyId: "enemy-chaser", activeIntentId: "intent-secret", handler: "melee_strike" },
      formulaVersion: "fable.damage.v1",
      rawDamage: 17,
      defense: 42,
      multiplier: 0.5,
      finalDamage: 10,
    },
  } satisfies DomainEvent;
  const engine = new Proxy(base, {
    get(target, property, receiver) {
      if (property === "events") return () => [...target.events(), ...(emitted ? [hiddenTargetSelection, hiddenDamageDetails] : [])];
      if (property === "advanceTicks") return (count: number) => {
        const result = target.advanceTicks(count);
        emitted = true;
        return result;
      };
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as SimulationEngine;
  return new PlayerGmVerticalSlice(engine);
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
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP port");
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

describe("WebSocket transport", () => {
  it("authenticates membership, routes a move and supports reconnect", async () => {
    const server = createServer();
    const player = await openClient(server);
    let resumeToken = "";
    try {
      const initialMessagesPromise = nextMessages(player, 2);
      player.send(JSON.stringify({ type: "hello", campaignId, role: "player", token: "player-token", actorId: "player-1" }));
      const initialMessages = await initialMessagesPromise;
      const ready = initialMessages[0];
      const projection = initialMessages[1];
      if (!ready || !projection || ready.type !== "room.ready") throw new Error("Expected ready and projection messages");
      resumeToken = ready.resumeToken ?? "";
      expect(resumeToken).not.toBe("");
      expect(projection.type).toBe("projection");

      const commandMessagesPromise = nextMessages(player, 3);
      player.send(JSON.stringify({ type: "command", command: { kind: "player.move", requestId: "ws-move-1", direction: "right" } }));
      const messages = await commandMessagesPromise;
      expect(messages.some((message) => message.type === "events")).toBe(true);
      expect(messages.some((message) => message.type === "projection")).toBe(true);
      expect(messages.some((message) => message.type === "command.result" && message.result.status === "accepted")).toBe(true);
    } finally {
      await closeClient(player);
    }

    const reconnect = await openClient(server);
    try {
      const reconnectMessagesPromise = nextMessages(reconnect, 2);
      reconnect.send(JSON.stringify({ type: "hello", campaignId, role: "player", token: "player-token", actorId: "player-1", resumeToken }));
      const reconnectMessages = await reconnectMessagesPromise;
      expect(reconnectMessages.some((message) => message.type === "room.ready")).toBe(true);
      expect(reconnectMessages.some((message) => message.type === "projection")).toBe(true);
    } finally {
      await closeClient(reconnect);
    }
  });

  it("rejects schema-invalid commands and enforces the token bucket", async () => {
    const server = createServer({ capacity: 1, refillPerSecond: 0.001 });
    const player = await openClient(server);
    try {
      const initialMessagesPromise = nextMessages(player, 2);
      player.send(JSON.stringify({ type: "hello", campaignId, role: "player", token: "player-token", actorId: "player-1" }));
      await initialMessagesPromise;

      const acceptedPromise = nextMessages(player, 3);
      player.send(JSON.stringify({ type: "command", command: { kind: "player.move", requestId: "rate-1", direction: "right" } }));
      await acceptedPromise;

      const rejectedPromise = nextMessages(player, 1);
      player.send(JSON.stringify({ type: "command", command: { kind: "player.move", requestId: "rate-2", direction: "right", extra: true } }));
      const [rejected] = await rejectedPromise;
      expect(rejected?.type).toBe("transport.error");
      if (rejected?.type === "transport.error") expect(rejected.reason).toContain("schema_validation_failed");

      const rateLimitedPromise = nextMessages(player, 1);
      player.send(JSON.stringify({ type: "command", command: { kind: "player.move", requestId: "rate-3", direction: "right" } }));
      const [rateLimited] = await rateLimitedPromise;
      expect(rateLimited).toEqual({ type: "transport.error", reason: "rate_limited" });
    } finally {
      await closeClient(player);
    }
  });

  it("filters domain events and forbidden fields differently for player and GM sockets", async () => {
    const server = createServer(undefined, visibilityFixtureSlice());
    const player = await openClient(server);
    const gm = await openClient(server);
    try {
      const playerReady = nextMessages(player, 2);
      player.send(JSON.stringify({ type: "hello", campaignId, role: "player", token: "player-token", actorId: "player-1" }));
      await playerReady;
      const gmReady = nextMessages(gm, 2);
      gm.send(JSON.stringify({ type: "hello", campaignId, role: "gm", token: "gm-token" }));
      await gmReady;

      const playerMessagesPromise = nextMessages(player, 3);
      const gmMessagesPromise = nextMessages(gm, 3);
      player.send(JSON.stringify({ type: "command", command: { kind: "player.move", requestId: "visibility-move-1", direction: "right" } }));
      const [playerMessages, gmMessages] = await Promise.all([playerMessagesPromise, gmMessagesPromise]);
      const playerEvents = playerMessages.find((message) => message.type === "events");
      const gmEvents = gmMessages.find((message) => message.type === "events");
      expect(playerEvents?.type).toBe("events");
      expect(gmEvents?.type).toBe("events");
      if (playerEvents?.type !== "events" || gmEvents?.type !== "events") throw new Error("Expected events on both role sockets");

      const playerProjections = playerMessages.filter((message) => message.type === "projection");
      const gmProjections = gmMessages.filter((message) => message.type === "projection");
      expect(playerProjections).toHaveLength(1);
      expect(gmProjections).toHaveLength(1);
      expect(playerProjections[0]?.type === "projection" ? playerProjections[0].projection.projection : undefined).toBe("player");
      expect(gmProjections[0]?.type === "projection" ? gmProjections[0].projection.projection : undefined).toBe("gm");
      expect(playerMessages.some((message) => message.type === "projection" && message.projection.projection === "gm")).toBe(false);

      expect(playerEvents.events.some((event) => event.eventType === "intent.target_selected")).toBe(false);
      const playerHp = playerEvents.events.find((event) => event.eventId === "visibility-hp-change");
      expect(playerHp).toBeDefined();
      expect(playerHp?.replay).toBeNull();
      expect(playerHp?.actorId).toBeNull();
      if (playerHp) {
        expect("source" in playerHp.payload).toBe(false);
        expect("formulaVersion" in playerHp.payload).toBe(false);
        expect("rawDamage" in playerHp.payload).toBe(false);
        if (playerHp.eventType === "hp.changed") expect(playerHp.payload.publicAmount).toBe(10);
      }

      const gmTargetSelection = gmEvents.events.find((event) => event.eventId === "visibility-target-selection");
      const gmHp = gmEvents.events.find((event) => event.eventId === "visibility-hp-change");
      expect(gmTargetSelection?.eventType).toBe("intent.target_selected");
      expect(gmHp?.replay?.seedRef).toBe("secret-damage-seed");
      if (gmHp?.eventType === "hp.changed" && gmHp.eventVersion === 2) {
        expect(gmHp.payload.source).toBeDefined();
        expect(gmHp.payload.formulaVersion).toBe("fable.damage.v1");
        expect(gmHp.payload.rawDamage).toBe(17);
      }
    } finally {
      await Promise.all([closeClient(player), closeClient(gm)]);
    }
  });
});
