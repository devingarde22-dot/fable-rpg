import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createVerticalSliceWebSocketServer,
  createVerticalSliceWebSocketServerFromPersistence,
  createVerticalSliceEngine,
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  InMemorySlicePersistence,
  PlayerGmVerticalSlice,
  type SliceRole,
  type SlicePersistence,
  type WebSocketHello,
  type WebSocketCommand,
  type WebSocketServerMessage,
} from "../src/index.js";
import type { DomainEvent, SimulationEngine } from "../../rules/src/index.js";

const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];
const campaignId = "campaign-vertical-slice";
const auth = new InMemoryAuthProvider(new Map<string, { id: string; roles: readonly SliceRole[] }>([
  ["player-token", { id: "identity-player-1", roles: ["player"] }],
  ["gm-token", { id: "identity-gm", roles: ["gm"] }],
]));
const membership = new InMemoryCampaignMembershipStore([
  { campaignId, identityId: "identity-player-1", role: "player", actorId: "player-1" },
  { campaignId, identityId: "identity-gm", role: "gm" },
]);

function createServer(
  rateLimit?: { capacity?: number; refillPerSecond?: number },
  slice?: PlayerGmVerticalSlice,
  persistence?: SlicePersistence,
) {
  const options = {
    ...(slice ? { slice } : {}),
    auth,
    membership,
    ...(persistence ? { persistence } : {}),
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

async function dropClient(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.terminate();
  });
}

async function closeServer(server: ReturnType<typeof createVerticalSliceWebSocketServer>): Promise<void> {
  const index = servers.indexOf(server);
  if (index !== -1) servers.splice(index, 1);
  await server.close();
}

async function createRestoredServer(persistence: InMemorySlicePersistence) {
  const engine = createVerticalSliceEngine();
  const server = await createVerticalSliceWebSocketServerFromPersistence({
    campaignId,
    persistence,
    auth,
    membership,
    restoreConfig: {
      enemyTemplates: [...engine.state.enemyTemplates.values()],
      intentTemplates: [...engine.state.intentTemplates.values()],
    },
  });
  servers.push(server);
  return server;
}

async function expectSessionRecoveryAfterRestart(
  role: SliceRole,
  token: string,
  actorId: string | undefined,
  command: WebSocketCommand["command"],
): Promise<void> {
  const persistence = new InMemorySlicePersistence();
  const server = createServer(undefined, undefined, persistence);
  let originalSocket: WebSocket | null = await openClient(server);
  let restoredServer: ReturnType<typeof createVerticalSliceWebSocketServer> | null = null;
  let restoredSocket: WebSocket | null = null;
  let originalSessionId = "";

  try {
    const hello: WebSocketHello = {
      type: "hello",
      campaignId,
      role,
      token,
      ...(actorId ? { actorId } : {}),
    };
    const initialMessagesPromise = nextMessages(originalSocket, 2);
    originalSocket.send(JSON.stringify(hello));
    const initialMessages = await initialMessagesPromise;
    const ready = initialMessages.find((message) => message.type === "room.ready");
    const initialProjection = initialMessages.find((message) => message.type === "projection");
    if (ready?.type !== "room.ready" || initialProjection?.type !== "projection") {
      throw new Error("Expected initial room.ready and projection messages");
    }
    originalSessionId = ready.sessionId;
    const resumeToken = ready.resumeToken;
    if (!resumeToken) throw new Error("Expected a resumable session token");

    const updateCount = role === "player" ? 3 : 2;
    const updateMessagesPromise = nextMessages(originalSocket, updateCount);
    originalSocket.send(JSON.stringify({ type: "command", command }));
    const updateMessages = await updateMessagesPromise;
    const updatedProjection = updateMessages.find((message) => message.type === "projection");
    expect(updatedProjection?.type).toBe("projection");
    if (updatedProjection?.type !== "projection") throw new Error("Expected updated projection");

    await dropClient(originalSocket);
    originalSocket = null;
    await closeServer(server);

    restoredServer = await createRestoredServer(persistence);
    restoredSocket = await openClient(restoredServer);
    const reconnectHello: WebSocketHello = { ...hello, resumeToken };
    const restoredMessagesPromise = nextMessages(restoredSocket, 2);
    restoredSocket.send(JSON.stringify(reconnectHello));
    const restoredMessages = await restoredMessagesPromise;
    const restoredReady = restoredMessages.find((message) => message.type === "room.ready");
    const restoredProjection = restoredMessages.find((message) => message.type === "projection");

    expect(restoredReady?.type).toBe("room.ready");
    if (restoredReady?.type !== "room.ready") throw new Error("Expected restored room.ready");
    expect(restoredReady.sessionId).toBe(originalSessionId);
    expect(restoredReady.resumeToken).toBe(resumeToken);
    expect(restoredProjection?.type).toBe("projection");
    if (restoredProjection?.type !== "projection") throw new Error("Expected restored projection");
    expect(restoredProjection.projection).toEqual(updatedProjection.projection);
    expect(restoredProjection.projection.projection).toBe(role);
  } finally {
    if (originalSocket) await closeClient(originalSocket);
    if (restoredSocket) await closeClient(restoredSocket);
    if (servers.includes(server)) await closeServer(server);
    if (restoredServer && servers.includes(restoredServer)) await closeServer(restoredServer);
  }
}

describe("WebSocket transport", () => {
  it("authenticates membership, routes a move and supports reconnect", async () => {
    const server = createServer();
    const player = await openClient(server);
    let resumeToken = "";
    let originalSessionId = "";
    try {
      const initialMessagesPromise = nextMessages(player, 2);
      player.send(JSON.stringify({ type: "hello", campaignId, role: "player", token: "player-token", actorId: "player-1" }));
      const initialMessages = await initialMessagesPromise;
      const ready = initialMessages[0];
      const projection = initialMessages[1];
      if (!ready || !projection || ready.type !== "room.ready") throw new Error("Expected ready and projection messages");
      originalSessionId = ready.sessionId;
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
      const reconnectReady = reconnectMessages.find((message) => message.type === "room.ready");
      expect(reconnectReady?.type).toBe("room.ready");
      if (reconnectReady?.type !== "room.ready") throw new Error("Expected room.ready after reconnect");
      expect(reconnectReady.sessionId).toBe(originalSessionId);
      expect(reconnectReady.resumeToken).toBe(resumeToken);
      expect(reconnectMessages.some((message) => message.type === "projection")).toBe(true);
    } finally {
      await closeClient(reconnect);
    }
  });

  it("recovers the Player session and latest projection after WebSocket drop and server restart", async () => {
    await expectSessionRecoveryAfterRestart("player", "player-token", "player-1", {
      kind: "player.move",
      requestId: "player-reconnect-move",
      direction: "right",
    });
  });

  it("recovers the GM session and paused state after WebSocket drop and server restart", async () => {
    await expectSessionRecoveryAfterRestart("gm", "gm-token", undefined, {
      kind: "gm.pause",
      requestId: "gm-reconnect-pause",
      paused: true,
    });
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
