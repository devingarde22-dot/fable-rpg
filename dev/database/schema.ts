import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const visibilityEnum = pgEnum("visibility", ["public", "gm_only", "conditional"]);
export const sceneModeEnum = pgEnum("scene_mode", ["exploration", "battle", "paused", "finished"]);
export const entitySideEnum = pgEnum("entity_side", ["ally", "enemy", "neutral"]);
export const commandStatusEnum = pgEnum("command_status", ["proposed", "confirmed", "rejected", "applied", "failed"]);
export const loreKindEnum = pgEnum("lore_kind", ["place", "npc", "faction", "item", "event", "rule", "condition"]);

export const users = pgTable("users", {
  id: id(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("player"),
  ...timestamps,
});

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: varchar("name", { length: 180 }).notNull(),
  gmUserId: uuid("gm_user_id").notNull().references(() => users.id),
  rulesetVersion: varchar("ruleset_version", { length: 40 }).notNull().default("gdd_0.1"),
  doomsdayClock: integer("doomsday_clock").notNull().default(0),
  state: jsonb("state").$type<{ resources?: Record<string, number>; flags?: Record<string, boolean> }>().notNull().default({}),
  ...timestamps,
}, (t) => ({ gmIdx: uniqueIndex("campaign_gm_name_idx").on(t.gmUserId, t.name) }));

export const campaignMembers = pgTable("campaign_members", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.campaignId, t.userId] }) }));

export const factions = pgTable("factions", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 80 }).notNull(), name: varchar("name", { length: 160 }).notNull(),
  description: text("description").notNull().default(""), tags: jsonb("tags").$type<string[]>().notNull().default([]),
  ...timestamps,
}, (t) => ({ uniqueCampaignKey: uniqueIndex("faction_campaign_key_idx").on(t.campaignId, t.key) }));

export const regions = pgTable("regions", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 80 }).notNull(), name: varchar("name", { length: 160 }).notNull(),
  corruption: integer("corruption").notNull().default(0), state: varchar("state", { length: 40 }).notNull().default("stable"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (t) => ({ uniqueCampaignKey: uniqueIndex("region_campaign_key_idx").on(t.campaignId, t.key) }));

export const loreEntities = pgTable("lore_entities", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  kind: loreKindEnum("kind").notNull(), key: varchar("key", { length: 120 }).notNull(), name: varchar("name", { length: 180 }).notNull(),
  description: text("description").notNull().default(""), tags: jsonb("tags").$type<string[]>().notNull().default([]),
  canonLevel: integer("canon_level").notNull().default(1), source: varchar("source", { length: 120 }).notNull().default("gm"),
  visibility: visibilityEnum("visibility").notNull().default("public"), metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (t) => ({ uniqueCampaignKey: uniqueIndex("lore_campaign_key_idx").on(t.campaignId, t.key) }));

export const characters = pgTable("characters", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id), name: varchar("name", { length: 120 }).notNull(),
  hp: integer("hp").notNull(), maxHp: integer("max_hp").notNull(), stamina: integer("stamina").notNull().default(3), maxStamina: integer("max_stamina").notNull().default(3),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}), equipment: jsonb("equipment").$type<string[]>().notNull().default([]), cards: jsonb("cards").$type<string[]>().notNull().default([]), statuses: jsonb("statuses").$type<Record<string, unknown>[]>().notNull().default([]),
  ...timestamps,
});

export const sessions = pgTable("sessions", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(), status: varchar("status", { length: 30 }).notNull().default("active"), startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(), endedAt: timestamp("ended_at", { withTimezone: true }),
  ...timestamps,
});

export const scenes = pgTable("scenes", {
  id: id(), sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 120 }).notNull(), title: varchar("title", { length: 180 }).notNull(), mode: sceneModeEnum("mode").notNull().default("exploration"),
  grid: jsonb("grid").$type<{ width: number; height: number; blocked: [number, number][] }>().notNull(), timePaused: boolean("time_paused").notNull().default(false),
  publicState: jsonb("public_state").$type<Record<string, unknown>>().notNull().default({}), gmState: jsonb("gm_state").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const sceneEntities = pgTable("scene_entities", {
  id: id(), sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }), characterId: uuid("character_id").references(() => characters.id), templateId: varchar("template_id", { length: 120 }),
  name: varchar("name", { length: 160 }).notNull(), side: entitySideEnum("side").notNull(), x: integer("x").notNull(), y: integer("y").notNull(), hp: integer("hp").notNull(), maxHp: integer("max_hp").notNull(),
  statuses: jsonb("statuses").$type<Record<string, unknown>[]>().notNull().default([]), intent: jsonb("intent").$type<Record<string, unknown> | null>(), visibility: visibilityEnum("visibility").notNull().default("public"), spawnCondition: text("spawn_condition"), active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const campaignEvents = pgTable("campaign_events", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }), sessionId: uuid("session_id").references(() => sessions.id), sceneId: uuid("scene_id").references(() => scenes.id), type: varchar("type", { length: 100 }).notNull(), actorUserId: uuid("actor_user_id").references(() => users.id), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), visibility: visibilityEnum("visibility").notNull().default("public"), confirmedByGm: boolean("confirmed_by_gm").notNull().default(false), ...timestamps,
});

export const commandRequests = pgTable("command_requests", {
  id: id(), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }), sessionId: uuid("session_id").references(() => sessions.id), sceneId: uuid("scene_id").references(() => scenes.id), requestedBy: uuid("requested_by").references(() => users.id), confirmedBy: uuid("confirmed_by").references(() => users.id), command: varchar("command", { length: 80 }).notNull(), status: commandStatusEnum("status").notNull().default("proposed"), requestJson: jsonb("request_json").notNull(), resultJson: jsonb("result_json"), errorText: text("error_text"), ...timestamps,
});

export type SceneEntity = typeof sceneEntities.$inferSelect;
export type NewSceneEntity = typeof sceneEntities.$inferInsert;
export type CampaignEvent = typeof campaignEvents.$inferSelect;
export type CommandRequest = typeof commandRequests.$inferSelect;
