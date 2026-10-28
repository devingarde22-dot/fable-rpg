import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { PlayerGmVerticalSlice, type SliceCommand, type SliceConnection, type SliceRole, type SliceMessage } from "./index.js";

export type WebSocketHello = { type: "hello"; role: SliceRole; actorId?: string };
export type WebSocketCommand = { type: "command"; command: SliceCommand };
export type WebSocketClientMessage = WebSocketHello | WebSocketCommand;
export type WebSocketServerMessage = SliceMessage | { type: "transport.error"; reason: string };

type ClientSession = { sessionId: string; connection: SliceConnection };

function json(data: unknown): string {
  return JSON.stringify(data);
}

function parseMessage(data: RawData): unknown {
  try {
    return JSON.parse(data.toString()) as unknown;
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is SliceRole {
  return value === "player" || value === "gm";
}

function isSliceCommand(value: unknown): value is SliceCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (typeof command.kind !== "string" || typeof command.requestId !== "string") return false;
  if (command.kind === "player.move") return ["up", "down", "left", "right"].includes(command.direction as string);
  if (command.kind === "gm.pause") return typeof command.paused === "boolean";
  if (command.kind === "gm.end_expedition") return ["success", "retreat", "defeat", "gm_abort"].includes(command.outcome as string) && typeof command.reason === "string";
  return false;
}

function isHello(value: unknown): value is WebSocketHello {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "hello" && isRole(message.role) && (message.actorId === undefined || typeof message.actorId === "string");
}

function isCommandMessage(value: unknown): value is WebSocketCommand {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "command" && isSliceCommand(message.command);
}

export type VerticalSliceWebSocketServer = {
  readonly httpServer: HttpServer;
  readonly websocketServer: WebSocketServer;
  readonly slice: PlayerGmVerticalSlice;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
};

export function createVerticalSliceWebSocketServer(slice = new PlayerGmVerticalSlice()): VerticalSliceWebSocketServer {
  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientSession>();
  let sessionCounter = 0;

  const send = (socket: WebSocket, message: WebSocketServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(json(message));
  };
  const flush = () => {
    for (const [socket, session] of clients) {
      const messages = session.connection.drain();
      for (const message of messages) send(socket, message);
    }
  };

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client, request));
  });

  websocketServer.on("connection", (socket) => {
    let session: ClientSession | null = null;
    const reject = (reason: string) => send(socket, { type: "transport.error", reason });
    socket.on("message", (data) => {
      const message = parseMessage(data);
      if (!session) {
        if (!isHello(message)) {
          reject("first message must be a hello with role and optional actorId");
          socket.close(1008, "hello required");
          return;
        }
        const sessionId = `ws-session-${++sessionCounter}`;
        try {
          session = { sessionId, connection: slice.connect(message.role, sessionId, message.actorId) };
          clients.set(socket, session);
          flush();
        } catch (error) {
          reject(error instanceof Error ? error.message : "connection rejected");
          socket.close(1008, "connection rejected");
        }
        return;
      }
      if (!isCommandMessage(message)) {
        reject("invalid command envelope");
        return;
      }
      try {
        for (const response of session.connection.send(message.command)) send(socket, response);
        flush();
      } catch (error) {
        reject(error instanceof Error ? error.message : "command rejected");
      }
    });
    socket.on("close", () => {
      if (session) {
        slice.disconnect(session.sessionId);
        clients.delete(socket);
      }
    });
    socket.on("error", () => {
      if (session) {
        slice.disconnect(session.sessionId);
        clients.delete(socket);
      }
    });
  });

  return {
    httpServer,
    websocketServer,
    slice,
    listen: (port, host = "127.0.0.1") => new Promise((resolve) => httpServer.listen(port, host, resolve)),
    close: () => new Promise((resolve, reject) => {
      websocketServer.close((error) => {
        if (error) reject(error);
        else httpServer.close((httpError) => httpError ? reject(httpError) : resolve());
      });
    }),
  };
}
