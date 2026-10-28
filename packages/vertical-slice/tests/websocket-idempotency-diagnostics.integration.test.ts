import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createVerticalSliceEngine,
  createVerticalSliceWebSocketServer,
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  PlayerGmVerticalSlice,
  type AuthProvider,
  type SliceRole,
  type WebSocketErrorLog,
  type WebSocketServerMessage,
} from "../src/index.js";
import type { SimulationEngine } from "../../rules/src/index.js";

const campaignId = "campaign-websocket-diagnostics";
const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];
const membership = new InMemoryCampaignMembershipStore([
  { campaignId, identityId: "identity-player", role: "player", actorId: "player-1" },
  { campaignId, identityId: "identity-gm", role: "gm" },
]);

function createTestServer(options: {
  slice?: PlayerGmVerticalSlice;
  auth?: AuthProvider;
  logger?: (record: WebSocketErrorLog) => void;
} = {}) {
  const token = "player-token";
  const auth = options.auth ?? new InMemoryAuthProvider(new Map<string, { id: string; roles: readonly SliceRole[] }>([
    [token, { id: "identity-player", roles: ["player"] }],
  ]));
  const server = createVerticalSliceWebSocketServer({
    campaignId,
    auth,
    membership,
    ...(options.slice ? { slice: options.slice } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
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
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP port");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
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

async function authenticatePlayer(
  socket: WebSocket,
  token = "player-token",
  resumeToken?: string,
): Promise<{ sessionId: string; resumeToken: string }> {
  const readyMessagesPromise = nextMessages(socket, 2);
  socket.send(JSON.stringify({
    type: "hello",
    campaignId,
    role: "player",
    token,
    actorId: "player-1",
    ...(resumeToken ? { resumeToken } : {}),
  }));
  const readyMessages = await readyMessagesPromise;
  const ready = readyMessages.find((message) => message.type === "room.ready");
  if (ready?.type !== "room.ready") throw new Error("Expected room.ready for Player");
  if (!ready.resumeToken) throw new Error("Expected room.ready to contain a resume token");
  return { sessionId: ready.sessionId, resumeToken: ready.resumeToken };
}

describe("WebSocket idempotency and diagnostics", () => {
  it("does not re-apply a player command when the same request is retried", async () => {
    const server = createTestServer();
    let player = await openClient(server);
    try {
      const originalSession = await authenticatePlayer(player);
      const command = { kind: "player.move", requestId: "retry-move-1", direction: "right" } as const;
      const firstMessagesPromise = nextMessages(player, 3);
      player.send(JSON.stringify({ type: "command", command }));
      const firstMessages = await firstMessagesPromise;
      expect(firstMessages.some((message) => message.type === "command.result" && message.result.status === "accepted")).toBe(true);

      const stateAfterFirst = server.slice.engine.snapshot();
      const eventCountAfterFirst = server.slice.engine.events().length;
      await closeClient(player);
      player = await openClient(server);
      const resumedSession = await authenticatePlayer(player, "player-token", originalSession.resumeToken);
      expect(resumedSession.sessionId).toBe(originalSession.sessionId);

      const retryMessagesPromise = nextMessages(player, 2);
      player.send(JSON.stringify({ type: "command", command }));
      const retryMessages = await retryMessagesPromise;
      const duplicateResult = retryMessages.find((message) => message.type === "command.result");

      expect(retryMessages.some((message) => message.type === "events")).toBe(false);
      expect(duplicateResult?.type).toBe("command.result");
      if (duplicateResult?.type !== "command.result") throw new Error("Expected command.result for retry");
      expect(duplicateResult.result).toMatchObject({
        status: "duplicate",
        requestId: command.requestId,
        original: { status: "accepted", requestId: command.requestId },
      });
      expect(server.slice.engine.snapshot()).toEqual(stateAfterFirst);
      expect(server.slice.engine.events()).toHaveLength(eventCountAfterFirst);
    } finally {
      await closeClient(player);
    }
  });

  it("logs rejected connections as structured safe records without the supplied token", async () => {
    const token = "connection-secret-token-should-never-be-logged";
    const logs: WebSocketErrorLog[] = [];
    const auth: AuthProvider = {
      authenticate: async (suppliedToken) => {
        throw new Error(`Authentication backend rejected ${suppliedToken}`);
      },
    };
    const server = createTestServer({ auth, logger: (record) => logs.push(record) });
    const socket = await openClient(server);
    try {
      const rejectionPromise = nextMessages(socket, 1);
      socket.send(JSON.stringify({ type: "hello", campaignId, role: "player", token, actorId: "player-1" }));
      const [rejection] = await rejectionPromise;

      expect(rejection).toEqual({ type: "transport.error", reason: "connection_setup_failed" });
      expect(logs).toEqual([{
        level: "error",
        event: "websocket.connection_error",
        campaignId,
        reason: "connection_setup_failed",
        role: "player",
      }]);
      expect(JSON.stringify(logs)).not.toContain(token);
      expect(JSON.stringify(rejection)).not.toContain(token);
    } finally {
      await closeClient(socket);
    }
  });

  it("logs command execution failures with safe structured metadata, not error text or token", async () => {
    const token = "command-secret-token-should-never-be-logged";
    const logs: WebSocketErrorLog[] = [];
    const baseEngine = createVerticalSliceEngine();
    const throwingEngine = new Proxy(baseEngine, {
      get(target, property, receiver) {
        if (property === "submit") return () => { throw new Error(`Synthetic command failure for ${token}`); };
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as SimulationEngine;
    const auth = new InMemoryAuthProvider(new Map<string, { id: string; roles: readonly SliceRole[] }>([
      [token, { id: "identity-player", roles: ["player"] }],
    ]));
    const server = createTestServer({
      slice: new PlayerGmVerticalSlice(throwingEngine),
      auth,
      logger: (record) => logs.push(record),
    });
    const player = await openClient(server);
    try {
      const { sessionId, resumeToken } = await authenticatePlayer(player, token);
      const requestId = "command-failure-1";
      const command = { kind: "player.move", requestId, direction: "right" } as const;
      const failurePromise = nextMessages(player, 1);
      player.send(JSON.stringify({ type: "command", command }));
      const [failure] = await failurePromise;

      expect(failure).toEqual({ type: "transport.error", reason: "command_execution_failed" });
      expect(logs).toEqual([{
        level: "error",
        event: "websocket.command_error",
        campaignId,
        reason: "command_execution_failed",
        role: "player",
        sessionId,
        commandKind: "player.move",
      }]);
      expect(JSON.stringify(logs)).not.toContain(token);
      expect(JSON.stringify(logs)).not.toContain(resumeToken);
      expect(JSON.stringify(logs)).not.toContain(requestId);
      expect(JSON.stringify(logs)).not.toContain(JSON.stringify(command));
      expect(JSON.stringify(logs)).not.toContain("Synthetic command failure");
      expect(JSON.stringify(failure)).not.toContain(token);
    } finally {
      await closeClient(player);
    }
  });
});
