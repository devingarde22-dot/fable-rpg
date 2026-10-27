import { Client, Room } from "colyseus";
import { MapSchema, Schema, ArraySchema, defineTypes } from "@colyseus/schema";
import { randomUUID } from "node:crypto";

export type Role = "tv" | "gm" | "player";
type Direction = "north" | "south" | "east" | "west";
type Side = "ally" | "enemy" | "neutral";

class EntityState extends Schema {
  id = "";
  name = "";
  side: Side = "neutral";
  x = 0;
  y = 0;
  hp = 1;
  maxHp = 1;
  visibility: "public" | "gm_only" | "conditional" = "public";
  active = true;
}
defineTypes(EntityState, {
  id: "string", name: "string", side: "string", x: "number", y: "number",
  hp: "number", maxHp: "number", visibility: "string", active: "boolean",
});

class CampaignState extends Schema {
  sceneId = "";
  mode: "exploration" | "battle" | "paused" = "exploration";
  timePaused = false;
  entities = new MapSchema<EntityState>();
  connectedRoles = new MapSchema<string>();
}
defineTypes(CampaignState, {
  sceneId: "string", mode: "string", timePaused: "boolean",
  entities: { map: EntityState }, connectedRoles: { map: "string" },
});

type JoinOptions = { role: Role; playerId?: string; campaignId: string; sceneId: string };
type MoveMessage = { direction: Direction };
type PrepareSpawnMessage = {
  requestId: string;
  templateId: string;
  count: number;
  side: Side;
  positions: { x: number; y: number }[];
  visibility?: "public" | "gm_only" | "conditional";
  behavior?: string;
};
type ConfirmSpawnMessage = { requestId: string; entityIds: string[] };

export class CampaignRoom extends Room<CampaignState> {
  maxClients = 8;
  private roleBySession = new Map<string, Role>();
  private campaignId = "";
  private blocked = new Set<string>(["4:4", "5:4"]);

  onCreate(options: { campaignId: string; sceneId: string }) {
    this.campaignId = options.campaignId;
    this.setState(new CampaignState());
    this.state.sceneId = options.sceneId;
    this.state.mode = "battle";

    this.onMessage("player.move", (client, message: MoveMessage) => this.handleMove(client, message));
    this.onMessage("gm.prepare_spawn", (client, message: PrepareSpawnMessage) => this.prepareSpawn(client, message));
    this.onMessage("gm.confirm_spawn", (client, message: ConfirmSpawnMessage) => this.confirmSpawn(client, message));
    this.onMessage("gm.pause_time", (client, message: { paused: boolean }) => {
      this.assertRole(client, "gm");
      this.state.timePaused = message.paused;
      this.broadcast("scene.time_paused", { paused: message.paused, reason: "gm" });
    });
  }

  async onJoin(client: Client, options: JoinOptions) {
    if (!options?.campaignId || options.campaignId !== this.campaignId) throw new Error("Invalid campaign");
    if (!["tv", "gm", "player"].includes(options.role)) throw new Error("Invalid role");
    this.roleBySession.set(client.sessionId, options.role);
    this.state.connectedRoles.set(client.sessionId, options.role);
    client.send("room.ready", { roomId: this.roomId, role: options.role, sceneId: this.state.sceneId });
  }

  onLeave(client: Client) {
    this.roleBySession.delete(client.sessionId);
    this.state.connectedRoles.delete(client.sessionId);
  }

  private role(client: Client): Role {
    const role = this.roleBySession.get(client.sessionId);
    if (!role) throw new Error("Unknown session role");
    return role;
  }

  private assertRole(client: Client, expected: Role) {
    if (this.role(client) !== expected) throw new Error(`Role ${expected} required`);
  }

  private handleMove(client: Client, message: MoveMessage) {
    this.assertRole(client, "player");
    if (this.state.timePaused || this.state.mode !== "battle") return client.send("command.rejected", { reason: "scene_paused_or_not_battle" });
    const player = [...this.state.entities.values()].find((e) => e.id === `player:${client.sessionId}`);
    if (!player) return client.send("command.rejected", { reason: "player_entity_missing" });
    const delta: Record<Direction, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const d = delta[message.direction];
    if (!d) return client.send("command.rejected", { reason: "invalid_direction" });
    const next = { x: player.x + d[0], y: player.y + d[1] };
    if (next.x < 0 || next.y < 0 || next.x >= 18 || next.y >= 12 || this.blocked.has(`${next.x}:${next.y}`)) {
      return client.send("command.rejected", { reason: "cell_blocked" });
    }
    const occupied = [...this.state.entities.values()].some((e) => e.active && e.x === next.x && e.y === next.y);
    if (occupied) return client.send("command.rejected", { reason: "cell_occupied" });
    player.x = next.x;
    player.y = next.y;
    this.broadcast("scene.entity_moved", { entityId: player.id, x: player.x, y: player.y });
  }

  private prepareSpawn(client: Client, request: PrepareSpawnMessage) {
    this.assertRole(client, "gm");
    if (!request?.requestId || !request.templateId || request.count < 1 || request.count > 20) {
      return client.send("command.rejected", { reason: "invalid_spawn_request" });
    }
    const positions = request.positions.slice(0, request.count);
    const invalid = positions.some((p) => this.isBlockedOrOccupied(p.x, p.y));
    if (invalid || positions.length !== request.count) return client.send("command.rejected", { reason: "invalid_spawn_positions" });

    const entityIds = positions.map(() => `pending:${randomUUID()}`);
    // Pending entities are GM-only until confirmation; they do not participate in the scene yet.
    client.send("gm.spawn_proposed", {
      requestId: request.requestId,
      templateId: request.templateId,
      count: request.count,
      side: request.side,
      positions,
      entityIds,
      visibility: request.visibility ?? "public",
      behavior: request.behavior ?? "default",
      spawnEffect: "accent_2s_yellow_ring",
    });
  }

  private confirmSpawn(client: Client, message: ConfirmSpawnMessage) {
    this.assertRole(client, "gm");
    // In production, load the validated proposal from command_requests by requestId.
    if (!message?.requestId || !message.entityIds?.length) return client.send("command.rejected", { reason: "invalid_confirmation" });
    const entityIds = message.entityIds.map(() => `npc:${randomUUID()}`);
    // Demo positions. Production code must use the persisted, validated proposal, never client-supplied positions.
    entityIds.forEach((id, index) => {
      const entity = new EntityState();
      entity.id = id;
      entity.name = "Наёмник Корпуса";
      entity.side = "ally";
      entity.x = 10 + index;
      entity.y = 2;
      entity.hp = entity.maxHp = 2800;
      entity.visibility = "public";
      this.state.entities.set(id, entity);
    });
    const previousPause = this.state.timePaused;
    this.state.timePaused = true;
    this.broadcast("scene.spawn_accent", { entityIds, effect: "accent_2s_yellow_ring", durationMs: 2000 });
    this.clock.setTimeout(() => {
      this.state.timePaused = previousPause;
      this.broadcast("scene.spawn_applied", { entityIds, requestId: message.requestId });
    }, 2000);
  }

  private isBlockedOrOccupied(x: number, y: number) {
    return x < 0 || y < 0 || x >= 18 || y >= 12 || this.blocked.has(`${x}:${y}`) || [...this.state.entities.values()].some((e) => e.active && e.x === x && e.y === y);
  }
}
