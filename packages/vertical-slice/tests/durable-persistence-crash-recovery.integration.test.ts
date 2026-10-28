import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createVerticalSliceEngine,
  createVerticalSliceWebSocketServer,
  createVerticalSliceWebSocketServerFromPersistence,
  createVerticalSliceRestoreConfig,
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  SqliteSlicePersistence,
  type SliceRole,
  type WebSocketHello,
  type WebSocketServerMessage,
} from "../src/index.js";

const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];
const tempDirs: string[] = [];
const campaignId = "campaign-persistence-crash-recovery";

const auth = new InMemoryAuthProvider(
  new Map<string, { id: string; roles: readonly SliceRole[] }>([
    ["player-token", { id: "identity-player", roles: ["player"] }],
    ["gm-token", { id: "identity-gm", roles: ["gm"] }],
  ]),
);

const membership = new InMemoryCampaignMembershipStore([
  { campaignId, identityId: "identity-player", role: "player", actorId: "player-1" },
  { campaignId, identityId: "identity-gm", role: "gm" },
]);

function createTempDb(): { dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "fable-db-"));
  tempDirs.push(dir);
  return { dbPath: join(dir, "fable-slice.sqlite"), dir };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    try {
      await server.close();
    } catch {
      // Ignore cleanup error
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

function nextMessages(socket: WebSocket, count: number): Promise<WebSocketServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: WebSocketServerMessage[] = [];
    const onMessage = (data: RawData) => {
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

describe("Durable Persistence & Crash Recovery", () => {
  it("persists sessions, snapshots, command receipts and campaign events to SQLite across cold restarts", () => {
    const { dbPath } = createTempDb();
    const persistence1 = new SqliteSlicePersistence(dbPath);
    const engine = createVerticalSliceEngine();
    const testCampaignId = engine.state.campaignId;

    // 1. Session persistence
    persistence1.saveSession({
      resumeToken: "resume-token-123",
      campaignId: testCampaignId,
      sessionId: "session-1",
      identityId: "identity-player",
      role: "player",
      actorId: "player-1",
      updatedAt: 1000,
    });
    const loadedSession = persistence1.loadSession("resume-token-123");
    expect(loadedSession).toEqual({
      resumeToken: "resume-token-123",
      campaignId: testCampaignId,
      sessionId: "session-1",
      identityId: "identity-player",
      role: "player",
      actorId: "player-1",
      updatedAt: 1000,
    });

    // 2. Snapshot persistence
    const snapshot = engine.snapshot();
    persistence1.saveSnapshot(testCampaignId, snapshot);
    const loadedSnapshot = persistence1.loadSnapshot(testCampaignId);
    expect(loadedSnapshot).toEqual(snapshot);

    // 3. Command receipt persistence
    persistence1.saveCommandReceipt({
      requestId: "cmd-req-1",
      campaignId: testCampaignId,
      sessionId: "session-1",
      sceneId: "quarantine-gates",
      actorId: "player-1",
      command: "player.move",
      status: "accepted",
      clientRevision: 1,
      requestPayload: { direction: "right" },
      result: { requestId: "cmd-req-1", status: "accepted", sceneRevision: 2 },
      errorCode: null,
      createdAt: 2000,
      updatedAt: 2000,
    });
    const loadedReceipt = persistence1.loadCommandReceipt("cmd-req-1", testCampaignId);
    expect(loadedReceipt).toMatchObject({
      requestId: "cmd-req-1",
      campaignId: testCampaignId,
      sessionId: "session-1",
      sceneId: "quarantine-gates",
      actorId: "player-1",
      command: "player.move",
      status: "accepted",
      result: { requestId: "cmd-req-1", status: "accepted", sceneRevision: 2 },
    });

    // 4. Campaign events append-only log
    const initialEvents = engine.events();
    expect(initialEvents.length).toBeGreaterThan(0);
    persistence1.appendEvents(initialEvents);
    const loadedEvents = persistence1.loadEvents(testCampaignId, 0);
    expect(loadedEvents.length).toBe(initialEvents.length);
    expect(loadedEvents[0]?.eventId).toBe(initialEvents[0]?.eventId);

    persistence1.close();

    // 5. Cold restart: re-open from the same database file
    const persistence2 = new SqliteSlicePersistence(dbPath);
    expect(persistence2.loadSession("resume-token-123")).toEqual(loadedSession);
    expect(persistence2.loadSnapshot(testCampaignId)).toEqual(snapshot);
    expect(persistence2.loadCommandReceipt("cmd-req-1", testCampaignId)).toEqual(loadedReceipt);
    expect(persistence2.loadEvents(testCampaignId, 0)).toEqual(loadedEvents);

    persistence2.close();
  });

  it("survives server crash and cold restart: recovers session via resumeToken and rejects duplicate requestId", async () => {
    const { dbPath } = createTempDb();
    const persistence1 = new SqliteSlicePersistence(dbPath);

    // Step A: Start Server 1 with SQLite persistence
    const server1 = createVerticalSliceWebSocketServer({
      campaignId,
      persistence: persistence1,
      auth,
      membership,
    });
    servers.push(server1);

    // Step B: Player connects, authenticates and receives resumeToken
    let player = await openClient(server1);
    const hello: WebSocketHello = {
      type: "hello",
      campaignId,
      role: "player",
      token: "player-token",
      actorId: "player-1",
    };

    const initialMessagesPromise = nextMessages(player, 2);
    player.send(JSON.stringify(hello));
    const initialMessages = await initialMessagesPromise;
    const ready = initialMessages.find((msg) => msg.type === "room.ready");
    expect(ready?.type).toBe("room.ready");
    if (ready?.type !== "room.ready" || !ready.resumeToken) {
      throw new Error("Expected room.ready with resumeToken");
    }
    const { sessionId, resumeToken } = ready;

    // Step C: Player sends player.move command
    const moveCommand = {
      kind: "player.move",
      requestId: "crash-recovery-move-1",
      direction: "right",
    } as const;

    const moveMessagesPromise = nextMessages(player, 3);
    player.send(JSON.stringify({ type: "command", command: moveCommand }));
    const moveMessages = await moveMessagesPromise;

    const moveResult = moveMessages.find((msg) => msg.type === "command.result");
    expect(moveResult?.type).toBe("command.result");
    if (moveResult?.type !== "command.result") throw new Error("Expected command.result");
    expect(moveResult.result).toMatchObject({
      status: "accepted",
      requestId: "crash-recovery-move-1",
    });

    const projectionAfterMove = moveMessages.find((msg) => msg.type === "projection");
    expect(projectionAfterMove?.type).toBe("projection");
    if (projectionAfterMove?.type !== "projection") throw new Error("Expected projection");
    const heroAfterMove = projectionAfterMove.projection.entities.find((e) => e.id === "hero-1");
    expect(heroAfterMove?.position).toEqual({ x: 2, y: 2 });

    // Verify persistence has saved the command receipt and snapshot
    const receiptBeforeCrash = persistence1.loadCommandReceipt("crash-recovery-move-1", campaignId);
    expect(receiptBeforeCrash).not.toBeNull();
    expect(receiptBeforeCrash?.status).toBe("accepted");

    const eventsBeforeCrash = persistence1.loadEvents(campaignId);
    expect(eventsBeforeCrash.some((e) => e.eventType === "scene.entity_moved")).toBe(true);

    // Step D: CRASH! Disconnect player, kill Server 1, close persistence 1
    await closeClient(player);
    await server1.close();
    persistence1.close();
    const server1Index = servers.indexOf(server1);
    if (server1Index !== -1) servers.splice(server1Index, 1);

    // Step E: COLD RESTART! Create Server 2 with a new persistence instance targeting the same SQLite file
    const persistence2 = new SqliteSlicePersistence(dbPath);
    const server2 = await createVerticalSliceWebSocketServerFromPersistence({
      campaignId,
      persistence: persistence2,
      auth,
      membership,
      restoreConfig: createVerticalSliceRestoreConfig(),
    });
    servers.push(server2);

    // Step F: Player reconnects with resumeToken to Server 2
    player = await openClient(server2);
    const reconnectHello: WebSocketHello = {
      type: "hello",
      campaignId,
      role: "player",
      token: "player-token",
      actorId: "player-1",
      resumeToken,
    };

    const reconnectMessagesPromise = nextMessages(player, 2);
    player.send(JSON.stringify(reconnectHello));
    const reconnectMessages = await reconnectMessagesPromise;

    const restoredReady = reconnectMessages.find((msg) => msg.type === "room.ready");
    expect(restoredReady?.type).toBe("room.ready");
    if (restoredReady?.type !== "room.ready") throw new Error("Expected room.ready upon reconnect");
    expect(restoredReady.sessionId).toBe(sessionId);
    expect(restoredReady.resumeToken).toBe(resumeToken);

    const restoredProjection = reconnectMessages.find((msg) => msg.type === "projection");
    expect(restoredProjection?.type).toBe("projection");
    if (restoredProjection?.type !== "projection") throw new Error("Expected restored projection");
    const restoredHero = restoredProjection.projection.entities.find((e) => e.id === "hero-1");
    expect(restoredHero?.position).toEqual({ x: 2, y: 2 });

    // Step G: Player RETRIES the exact same command (requestId: "crash-recovery-move-1")
    const server2EngineEventsCountBeforeRetry = server2.slice.engine.events().length;
    const retryMessagesPromise = nextMessages(player, 2);
    player.send(JSON.stringify({ type: "command", command: moveCommand }));
    const retryMessages = await retryMessagesPromise;

    // Must NOT emit any events
    expect(retryMessages.some((msg) => msg.type === "events")).toBe(false);

    // Must return duplicate command result with the original accepted result
    const duplicateResult = retryMessages.find((msg) => msg.type === "command.result");
    expect(duplicateResult?.type).toBe("command.result");
    if (duplicateResult?.type !== "command.result") throw new Error("Expected duplicate command.result");
    expect(duplicateResult.result).toMatchObject({
      status: "duplicate",
      requestId: "crash-recovery-move-1",
      original: {
        status: "accepted",
        requestId: "crash-recovery-move-1",
      },
    });

    // Engine state must NOT be re-mutated (hero position must remain 2,2, not 3,2)
    const heroAfterRetry = server2.slice.engine.snapshot().entities.find((e) => e.id === "hero-1");
    expect(heroAfterRetry?.position).toEqual({ x: 2, y: 2 });
    expect(server2.slice.engine.events()).toHaveLength(server2EngineEventsCountBeforeRetry);

    // Step H: Player sends a NEW valid command with a new requestId
    const move2Command = {
      kind: "player.move",
      requestId: "crash-recovery-move-2",
      direction: "down",
    } as const;

    const move2MessagesPromise = nextMessages(player, 3);
    player.send(JSON.stringify({ type: "command", command: move2Command }));
    const move2Messages = await move2MessagesPromise;

    const move2Result = move2Messages.find((msg) => msg.type === "command.result");
    expect(move2Result?.type).toBe("command.result");
    if (move2Result?.type !== "command.result") throw new Error("Expected command.result for move 2");
    expect(move2Result.result).toMatchObject({
      status: "accepted",
      requestId: "crash-recovery-move-2",
    });

    const heroAfterMove2 = server2.slice.engine.snapshot().entities.find((e) => e.id === "hero-1");
    expect(heroAfterMove2?.position).toEqual({ x: 2, y: 3 });

    // Verify move 2 receipt is saved in persistent storage
    const receipt2 = persistence2.loadCommandReceipt("crash-recovery-move-2", campaignId);
    expect(receipt2).not.toBeNull();
    expect(receipt2?.status).toBe("accepted");

    await closeClient(player);
    persistence2.close();
  });

  it("handles GM commands crash recovery: preserves pause state and rejects duplicate GM command requestId", async () => {
    const { dbPath } = createTempDb();
    const persistence1 = new SqliteSlicePersistence(dbPath);

    const server1 = createVerticalSliceWebSocketServer({
      campaignId,
      persistence: persistence1,
      auth,
      membership,
    });
    servers.push(server1);

    let gm = await openClient(server1);
    const gmHello: WebSocketHello = {
      type: "hello",
      campaignId,
      role: "gm",
      token: "gm-token",
    };

    const gmInitialPromise = nextMessages(gm, 2);
    gm.send(JSON.stringify(gmHello));
    const gmInitial = await gmInitialPromise;
    const ready = gmInitial.find((m) => m.type === "room.ready");
    if (ready?.type !== "room.ready" || !ready.resumeToken) throw new Error("Expected GM room.ready with resumeToken");
    const { resumeToken, sessionId } = ready;

    const pauseCommand = {
      kind: "gm.pause",
      requestId: "gm-pause-crash-1",
      paused: true,
    } as const;

    const pauseMessagesPromise = nextMessages(gm, 2);
    gm.send(JSON.stringify({ type: "command", command: pauseCommand }));
    const pauseMessages = await pauseMessagesPromise;
    const pauseResult = pauseMessages.find((m) => m.type === "command.result");
    expect(pauseResult?.type).toBe("command.result");
    if (pauseResult?.type !== "command.result") throw new Error("Expected command.result");
    expect(pauseResult.result).toMatchObject({ status: "accepted" });

    // Verify snapshot is paused
    expect(server1.slice.engine.snapshot().paused).toBe(true);

    // Crash server 1
    await closeClient(gm);
    await server1.close();
    persistence1.close();
    const s1Idx = servers.indexOf(server1);
    if (s1Idx !== -1) servers.splice(s1Idx, 1);

    // Restart server 2
    const persistence2 = new SqliteSlicePersistence(dbPath);
    const server2 = await createVerticalSliceWebSocketServerFromPersistence({
      campaignId,
      persistence: persistence2,
      auth,
      membership,
      restoreConfig: createVerticalSliceRestoreConfig(),
    });
    servers.push(server2);

    expect(server2.slice.engine.snapshot().paused).toBe(true);

    // GM reconnects
    gm = await openClient(server2);
    const gmReconnectPromise = nextMessages(gm, 2);
    gm.send(JSON.stringify({ ...gmHello, resumeToken }));
    const gmRestored = await gmReconnectPromise;
    const restoredReady = gmRestored.find((m) => m.type === "room.ready");
    expect(restoredReady?.type).toBe("room.ready");
    if (restoredReady?.type !== "room.ready") throw new Error("Expected restored GM ready");
    expect(restoredReady.sessionId).toBe(sessionId);

    // GM retries pauseCommand
    const retryPromise = nextMessages(gm, 2);
    gm.send(JSON.stringify({ type: "command", command: pauseCommand }));
    const retryMessages = await retryPromise;
    const duplicate = retryMessages.find((m) => m.type === "command.result");
    expect(duplicate?.type).toBe("command.result");
    if (duplicate?.type !== "command.result") throw new Error("Expected duplicate command.result for GM");
    expect(duplicate.result).toMatchObject({
      status: "duplicate",
      requestId: "gm-pause-crash-1",
      original: { status: "accepted" },
    });

    await closeClient(gm);
    persistence2.close();
  });
});
