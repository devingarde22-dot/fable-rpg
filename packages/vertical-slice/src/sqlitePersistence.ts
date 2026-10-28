import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DomainEvent, RuntimeSnapshot } from "../../rules/src/index.js";
import type { CommandReceipt, ResumeSession, SlicePersistence } from "./security.js";

function serializeSnapshot(snapshot: RuntimeSnapshot): string {
  return JSON.stringify(snapshot, (_key, value) => {
    if (value instanceof Map) {
      return { __type: "Map", entries: Array.from(value.entries()) };
    }
    return value;
  });
}

function deserializeSnapshot(json: string): RuntimeSnapshot {
  const parsed = JSON.parse(json, (_key, value) => {
    if (value && typeof value === "object" && value.__type === "Map" && Array.isArray(value.entries)) {
      return new Map(value.entries);
    }
    return value;
  }) as RuntimeSnapshot;

  if (parsed.scene && !(parsed.scene.contactImmunityUntilTick instanceof Map)) {
    if (Array.isArray(parsed.scene.contactImmunityUntilTick)) {
      parsed.scene.contactImmunityUntilTick = new Map(parsed.scene.contactImmunityUntilTick);
    } else if (parsed.scene.contactImmunityUntilTick && typeof parsed.scene.contactImmunityUntilTick === "object") {
      parsed.scene.contactImmunityUntilTick = new Map(Object.entries(parsed.scene.contactImmunityUntilTick));
    } else {
      parsed.scene.contactImmunityUntilTick = new Map();
    }
  }

  return parsed;
}

export class SqliteSlicePersistence implements SlicePersistence {
  private readonly db: DatabaseSync;

  constructor(filePath = ":memory:") {
    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS sessions (
        resume_token TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        role TEXT NOT NULL,
        actor_id TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        campaign_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_requests (
        request_id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        session_id TEXT,
        scene_id TEXT,
        actor_id TEXT,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        client_revision INTEGER,
        request_json TEXT,
        result_json TEXT,
        error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_command_requests_campaign_req
        ON command_requests (campaign_id, request_id);

      CREATE TABLE IF NOT EXISTS campaign_events (
        event_id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        session_id TEXT,
        scene_id TEXT,
        event_type TEXT NOT NULL,
        event_version INTEGER NOT NULL,
        actor_id TEXT,
        request_id TEXT,
        scene_revision INTEGER NOT NULL,
        server_tick INTEGER NOT NULL,
        server_sequence INTEGER NOT NULL,
        seed TEXT,
        payload_json TEXT NOT NULL,
        raw_event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_seq
        ON campaign_events (campaign_id, server_sequence);
      CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_created
        ON campaign_events (campaign_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_campaign_events_request
        ON campaign_events (campaign_id, request_id);
    `);
  }

  saveSession(session: ResumeSession): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (resume_token, campaign_id, session_id, identity_id, role, actor_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resume_token) DO UPDATE SET
        session_id = excluded.session_id,
        identity_id = excluded.identity_id,
        role = excluded.role,
        actor_id = excluded.actor_id,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      session.resumeToken,
      session.campaignId,
      session.sessionId,
      session.identityId,
      session.role,
      session.actorId ?? null,
      session.updatedAt,
    );
  }

  loadSession(resumeToken: string): ResumeSession | null {
    const stmt = this.db.prepare("SELECT * FROM sessions WHERE resume_token = ?");
    const row = stmt.get(resumeToken) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      resumeToken: String(row.resume_token),
      campaignId: String(row.campaign_id),
      sessionId: String(row.session_id),
      identityId: String(row.identity_id),
      role: row.role as "gm" | "player",
      actorId: row.actor_id ? String(row.actor_id) : null,
      updatedAt: Number(row.updated_at),
    };
  }

  saveSnapshot(campaignId: string, snapshot: RuntimeSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (campaign_id, snapshot_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(campaignId, serializeSnapshot(snapshot), Date.now());
  }

  loadSnapshot(campaignId: string): RuntimeSnapshot | null {
    const stmt = this.db.prepare("SELECT snapshot_json FROM snapshots WHERE campaign_id = ?");
    const row = stmt.get(campaignId) as { snapshot_json: string } | undefined;
    if (!row) return null;
    return deserializeSnapshot(row.snapshot_json);
  }

  saveCommandReceipt(receipt: CommandReceipt): void {
    const stmt = this.db.prepare(`
      INSERT INTO command_requests (
        request_id, campaign_id, session_id, scene_id, actor_id, command,
        status, client_revision, request_json, result_json, error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        status = excluded.status,
        result_json = excluded.result_json,
        error_code = excluded.error_code,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      receipt.requestId,
      receipt.campaignId,
      receipt.sessionId ?? null,
      receipt.sceneId ?? null,
      receipt.actorId ?? null,
      receipt.command,
      receipt.status,
      receipt.clientRevision ?? null,
      receipt.requestPayload !== undefined ? JSON.stringify(receipt.requestPayload) : null,
      receipt.result !== undefined ? JSON.stringify(receipt.result) : null,
      receipt.errorCode ?? null,
      receipt.createdAt ?? Date.now(),
      receipt.updatedAt ?? Date.now(),
    );
  }

  saveCommandRequest(receipt: CommandReceipt): void {
    this.saveCommandReceipt(receipt);
  }

  loadCommandReceipt(requestIdOrCampaignId: string, campaignIdOrRequestId?: string): CommandReceipt | null {
    let stmt;
    let row: Record<string, unknown> | undefined;

    if (campaignIdOrRequestId) {
      stmt = this.db.prepare(
        "SELECT * FROM command_requests WHERE (request_id = ? AND campaign_id = ?) OR (request_id = ? AND campaign_id = ?)",
      );
      row = stmt.get(
        requestIdOrCampaignId,
        campaignIdOrRequestId,
        campaignIdOrRequestId,
        requestIdOrCampaignId,
      ) as Record<string, unknown> | undefined;
    } else {
      stmt = this.db.prepare("SELECT * FROM command_requests WHERE request_id = ?");
      row = stmt.get(requestIdOrCampaignId) as Record<string, unknown> | undefined;
    }

    if (!row) return null;
    return {
      requestId: String(row.request_id),
      campaignId: String(row.campaign_id),
      sessionId: row.session_id ? String(row.session_id) : null,
      sceneId: row.scene_id ? String(row.scene_id) : null,
      actorId: row.actor_id ? String(row.actor_id) : null,
      command: String(row.command),
      status: String(row.status),
      clientRevision: row.client_revision != null ? Number(row.client_revision) : null,
      requestPayload: row.request_json ? JSON.parse(String(row.request_json)) : undefined,
      result: row.result_json ? JSON.parse(String(row.result_json)) : undefined,
      errorCode: row.error_code ? String(row.error_code) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  loadCommandRequest(requestId: string, campaignId?: string): CommandReceipt | null {
    return this.loadCommandReceipt(requestId, campaignId);
  }

  appendEvents(events: readonly DomainEvent[]): void {
    if (events.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO campaign_events (
        event_id, campaign_id, session_id, scene_id, event_type, event_version,
        actor_id, request_id, scene_revision, server_tick, server_sequence,
        seed, payload_json, raw_event_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      const now = Date.now();
      for (const event of events) {
        stmt.run(
          event.eventId,
          event.campaignId,
          event.sessionId ?? null,
          event.sceneId ?? null,
          event.eventType,
          event.eventVersion,
          event.actorId ?? null,
          event.causedByRequestId ?? null,
          event.sceneRevision,
          event.serverTick,
          event.serverSequence,
          event.replay?.seedRef ?? null,
          JSON.stringify(event.payload),
          JSON.stringify(event),
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendEvent(event: DomainEvent): void {
    this.appendEvents([event]);
  }

  loadEvents(campaignId: string, fromSequence = 0): readonly DomainEvent[] {
    const stmt = this.db.prepare(`
      SELECT raw_event_json FROM campaign_events
      WHERE campaign_id = ? AND server_sequence >= ?
      ORDER BY server_sequence ASC, created_at ASC
    `);
    const rows = stmt.all(campaignId, fromSequence) as Array<{ raw_event_json: string }>;
    return rows.map((row) => JSON.parse(row.raw_event_json) as DomainEvent);
  }

  close(): void {
    this.db.close();
  }
}
