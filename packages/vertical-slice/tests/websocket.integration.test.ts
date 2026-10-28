import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createVerticalSliceWebSocketServer,
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  type WebSocketServerMessage,
} from "../src/index.js";

const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];
const campaignId = "campaign-vertical-slice";

function createServer(rateLimit?: { capacity?: number; refillPerSecond?: number }) {
  const options = {
    auth: new InMemoryAuthProvider(new Map([["player-token", { id: "identity-player-1", roles: ["player"] as const }]])),
    membership: new InMemoryCampaignMembershipStore([{ campaignId, identityId: "identity-player-1", role: "player", actorId: "player-1" }]),
    ...(rateLimit ? { rateLimit } : {}),
  };
  const server = createVerticalSliceWebSocketServer(options);
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
});
