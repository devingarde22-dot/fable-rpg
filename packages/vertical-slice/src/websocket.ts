import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { PlayerGmVerticalSlice, type SliceCommand, type SliceConnection, type SliceRole, type SliceMessage } from "./index.js";
import { createSimulationEngineFromSnapshot, type SimulationEngineRestoreConfig } from "../../rules/src/index.js";
import { transportMessageSchema } from "./transportSchema.js";
import {
  InMemoryAuthProvider,
  InMemoryCampaignMembershipStore,
  InMemorySlicePersistence,
  TokenBucketRateLimiter,
  type AuthIdentity,
  type AuthProvider,
  type CampaignMembershipStore,
  type SlicePersistence,
} from "./security.js";

export type WebSocketHello = { type: "hello"; campaignId: string; role: SliceRole; token: string; actorId?: string; resumeToken?: string };
export type WebSocketCommand = { type: "command"; command: SliceCommand };
export type WebSocketClientMessage = WebSocketHello | WebSocketCommand;
export type WebSocketServerMessage = SliceMessage | { type: "transport.error"; reason: string };

type ConnectionErrorReason =
  | "invalid_message"
  | "hello_required"
  | "campaign_not_found"
  | "auth_failed"
  | "resume_not_authorized"
  | "campaign_membership_required"
  | "session_already_connected"
  | "connection_setup_failed"
  | "socket_error";
type CommandErrorReason = "invalid_message" | "invalid_command_envelope" | "command_execution_failed";
export type WebSocketErrorLog =
  | {
      level: "error";
      event: "websocket.connection_error";
      campaignId: string;
      reason: ConnectionErrorReason;
      role?: SliceRole;
      sessionId?: string;
    }
  | {
      level: "error";
      event: "websocket.command_error";
      campaignId: string;
      reason: CommandErrorReason;
      role: SliceRole;
      sessionId: string;
      commandKind?: SliceCommand["kind"];
    };
export type WebSocketErrorLogger = (record: WebSocketErrorLog) => void;

type ClientSession = {
  sessionId: string;
  connection: SliceConnection;
  identity: AuthIdentity;
  resumeToken: string;
  rateLimiter: TokenBucketRateLimiter;
};

export type VerticalSliceWebSocketOptions = {
  slice?: PlayerGmVerticalSlice;
  campaignId?: string;
  auth?: AuthProvider;
  membership?: CampaignMembershipStore;
  persistence?: SlicePersistence;
  rateLimit?: { capacity?: number; refillPerSecond?: number };
  logger?: WebSocketErrorLogger;
};

function json(data: unknown): string { return JSON.stringify(data); }
function parseMessage(data: RawData): unknown {
  try { return JSON.parse(data.toString()) as unknown; } catch { return null; }
}
function isRole(value: unknown): value is SliceRole { return value === "gm" || value === "player"; }
function isSliceCommand(value: unknown): value is SliceCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (typeof command.kind !== "string" || typeof command.requestId !== "string") return false;
  if (command.kind === "player.move") return ["up", "down", "left", "right"].includes(command.direction as string);
  if (command.kind === "gm.pause") return typeof command.paused === "boolean";
  return command.kind === "gm.end_expedition" && ["success", "retreat", "defeat", "gm_abort"].includes(command.outcome as string) && typeof command.reason === "string";
}
function isHello(value: unknown): value is WebSocketHello {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "hello" && typeof message.campaignId === "string" && isRole(message.role) && typeof message.token === "string" && (message.actorId === undefined || typeof message.actorId === "string") && (message.resumeToken === undefined || typeof message.resumeToken === "string");
}
function isCommandMessage(value: unknown): value is WebSocketCommand {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "command" && isSliceCommand(message.command);
}

function safeConnectionFailureReason(error: unknown): ConnectionErrorReason {
  const reason = error instanceof Error ? error.message : "";
  if (
    reason === "auth_failed" ||
    reason === "resume_not_authorized" ||
    reason === "campaign_membership_required" ||
    reason === "session_already_connected"
  ) return reason;
  return "connection_setup_failed";
}

export type VerticalSliceWebSocketServer = {
  readonly httpServer: HttpServer;
  readonly websocketServer: WebSocketServer;
  readonly slice: PlayerGmVerticalSlice;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
};

export function createVerticalSliceWebSocketServer(options: VerticalSliceWebSocketOptions = {}): VerticalSliceWebSocketServer {
  const slice = options.slice ?? new PlayerGmVerticalSlice();
  const campaignId = options.campaignId ?? slice.engine.state.campaignId;
  const auth = options.auth ?? new InMemoryAuthProvider(new Map());
  const membership = options.membership ?? new InMemoryCampaignMembershipStore([]);
  const persistence = options.persistence ?? new InMemorySlicePersistence();
  const logger = options.logger ?? ((record: WebSocketErrorLog) => console.error(JSON.stringify(record)));
  const logError = (record: WebSocketErrorLog) => {
    try { logger(record); } catch { /* A diagnostics sink must not affect the transport loop. */ }
  };
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateMessage = ajv.compile(transportMessageSchema);
  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, campaignId }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientSession>();
  let sessionCounter = 0;

  const send = (socket: WebSocket, message: WebSocketServerMessage, session?: ClientSession) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const outbound = message.type === "room.ready" && session
      ? { ...message, campaignId, resumeToken: session.resumeToken }
      : message;
    socket.send(json(outbound));
  };
  const flush = () => {
    for (const [socket, session] of clients) {
      for (const message of session.connection.drain()) send(socket, message, session);
    }
  };
  const persist = () => {
    try {
      void Promise.resolve(persistence.saveSnapshot(campaignId, slice.engine.snapshot())).catch(() => undefined);
    } catch {
      // Persistence failure must not crash the authoritative transport loop.
    }
  };
  const validationReason = () => validateMessage.errors?.map((error) => `${error.instancePath || "message"} ${error.message ?? "invalid"}`).join("; ") ?? "invalid message";
  const logConnectionError = (reason: ConnectionErrorReason, role?: SliceRole, sessionId?: string) => {
    logError({
      level: "error",
      event: "websocket.connection_error",
      campaignId,
      reason,
      ...(role ? { role } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  };
  const logCommandError = (session: ClientSession, reason: CommandErrorReason, commandKind?: SliceCommand["kind"]) => {
    logError({
      level: "error",
      event: "websocket.command_error",
      campaignId,
      role: session.connection.role,
      sessionId: session.sessionId,
      reason,
      ...(commandKind ? { commandKind } : {}),
    });
  };

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") { socket.destroy(); return; }
    websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client, request));
  });

  websocketServer.on("connection", (socket) => {
    let session: ClientSession | null = null;
    const reject = (reason: string) => send(socket, { type: "transport.error", reason }, session ?? undefined);
    socket.on("message", async (data) => {
      const message = parseMessage(data);
      if (!validateMessage(message)) {
        if (session) logCommandError(session, "invalid_message");
        else logConnectionError("invalid_message");
        reject(`schema_validation_failed: ${validationReason()}`);
        return;
      }
      if (!session) {
        if (!isHello(message)) {
          logConnectionError("hello_required");
          reject("first message must be hello");
          socket.close(1008, "hello required");
          return;
        }
        if (message.campaignId !== campaignId) {
          logConnectionError("campaign_not_found", message.role);
          reject("campaign_not_found");
          socket.close(1008, "campaign mismatch");
          return;
        }
        try {
          const identity = await auth.authenticate(message.token);
          if (!identity || !identity.roles.includes(message.role)) throw new Error("auth_failed");
          const resumed = message.resumeToken ? await persistence.loadSession(message.resumeToken) : null;
          if (resumed && (resumed.campaignId !== campaignId || resumed.identityId !== identity.id || resumed.role !== message.role || resumed.actorId !== (message.actorId ?? null))) throw new Error("resume_not_authorized");
          const actorId = resumed?.actorId ?? message.actorId;
          const requestedMembership = actorId === undefined ? { campaignId, role: message.role } : { campaignId, role: message.role, actorId };
          if (!await membership.canJoin(identity, requestedMembership)) throw new Error("campaign_membership_required");
          const sessionId = resumed?.sessionId ?? `ws-session-${++sessionCounter}`;
          if ([...clients.values()].some((candidate) => candidate.sessionId === sessionId)) throw new Error("session_already_connected");
          const resumeToken = resumed?.resumeToken ?? randomUUID();
          session = {
            sessionId,
            connection: slice.connect(message.role, sessionId, actorId),
            identity,
            resumeToken,
            rateLimiter: new TokenBucketRateLimiter(options.rateLimit?.capacity ?? 20, options.rateLimit?.refillPerSecond ?? 10),
          };
          clients.set(socket, session);
          await persistence.saveSession({ resumeToken, campaignId, sessionId, identityId: identity.id, role: message.role, actorId: actorId ?? null, updatedAt: Date.now() });
          flush();
        } catch (error) {
          const reason = safeConnectionFailureReason(error);
          logConnectionError(reason, message.role);
          reject(reason);
          socket.close(1008, "connection rejected");
        }
        return;
      }
      if (!isCommandMessage(message)) {
        logCommandError(session, "invalid_command_envelope");
        reject("invalid command envelope");
        return;
      }
      if (!session.rateLimiter.consume()) { reject("rate_limited"); return; }
      try {
        for (const response of session.connection.send(message.command)) send(socket, response, session);
        flush();
        persist();
      } catch {
        logCommandError(session, "command_execution_failed", message.command.kind);
        reject("command_execution_failed");
      }
    });
    socket.on("close", () => {
      if (session) { slice.disconnect(session.sessionId); clients.delete(socket); }
    });
    socket.on("error", () => {
      logConnectionError("socket_error", session?.connection.role, session?.sessionId);
      if (session) { slice.disconnect(session.sessionId); clients.delete(socket); }
    });
  });

  return {
    httpServer,
    websocketServer,
    slice,
    listen: (port, host = "127.0.0.1") => new Promise((resolve) => httpServer.listen(port, host, resolve)),
    close: () => new Promise((resolve, reject) => {
      for (const socket of clients.keys()) socket.terminate();
      websocketServer.close((error) => {
        if (error) reject(error);
        else httpServer.close((httpError) => httpError ? reject(httpError) : resolve());
      });
    }),
  };
}

export async function createVerticalSliceWebSocketServerFromPersistence(
  options: Omit<VerticalSliceWebSocketOptions, "slice" | "campaignId"> & {
    campaignId: string;
    restoreConfig: SimulationEngineRestoreConfig;
  },
): Promise<VerticalSliceWebSocketServer> {
  const persistence = options.persistence ?? new InMemorySlicePersistence();
  const snapshot = await persistence.loadSnapshot(options.campaignId);
  const slice = snapshot
    ? new PlayerGmVerticalSlice(createSimulationEngineFromSnapshot(snapshot, options.restoreConfig))
    : new PlayerGmVerticalSlice();
  return createVerticalSliceWebSocketServer({ ...options, persistence, slice });
}
