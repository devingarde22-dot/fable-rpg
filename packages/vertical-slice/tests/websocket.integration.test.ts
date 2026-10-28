import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createVerticalSliceWebSocketServer, type WebSocketServerMessage } from "../src/index.js";

const servers: Array<ReturnType<typeof createVerticalSliceWebSocketServer>> = [];

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

describe("WebSocket transport", () => {
  it("performs hello handshake and routes a player move", async () => {
    const server = createVerticalSliceWebSocketServer();
    servers.push(server);
    await server.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP port");
    const player = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      player.once("open", () => resolve());
      player.once("error", reject);
    });

    try {
      const initialMessagesPromise = nextMessages(player, 2);
      player.send(JSON.stringify({ type: "hello", role: "player", actorId: "player-1" }));
      const initialMessages = await initialMessagesPromise;
      const ready = initialMessages[0];
      const projection = initialMessages[1];
      if (!ready || !projection) throw new Error("Expected ready and projection messages");
      expect(ready.type).toBe("room.ready");
      expect(projection.type).toBe("projection");

      const commandMessagesPromise = nextMessages(player, 3);
      player.send(JSON.stringify({ type: "command", command: { kind: "player.move", requestId: "ws-move-1", direction: "right" } }));
      const messages = await commandMessagesPromise;
      expect(messages.some((message) => message.type === "events")).toBe(true);
      expect(messages.some((message) => message.type === "projection")).toBe(true);
      expect(messages.some((message) => message.type === "command.result" && message.result.status === "accepted")).toBe(true);
    } finally {
      player.close();
    }
  });
});
