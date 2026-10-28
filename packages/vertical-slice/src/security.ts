import type { DomainEvent, RuntimeSnapshot } from "../../rules/src/index.js";

export type AuthIdentity = { id: string; roles: readonly ("gm" | "player")[] };
export type AuthProvider = { authenticate(token: string): AuthIdentity | null | Promise<AuthIdentity | null> };
export type CampaignMembership = { campaignId: string; identityId: string; role: "gm" | "player"; actorId?: string };
export type CampaignMembershipStore = { canJoin(identity: AuthIdentity, membership: { campaignId: string; role: "gm" | "player"; actorId?: string }): boolean | Promise<boolean> };
export type ResumeSession = {
  resumeToken: string;
  campaignId: string;
  sessionId: string;
  identityId: string;
  role: "gm" | "player";
  actorId: string | null;
  updatedAt: number;
};
export type CommandReceipt = {
  requestId: string;
  campaignId: string;
  sessionId?: string | null;
  sceneId?: string | null;
  actorId?: string | null;
  command: string;
  status: string;
  clientRevision?: number | null;
  requestPayload?: unknown;
  result?: unknown;
  errorCode?: string | null;
  createdAt?: number;
  updatedAt?: number;
};
export type SlicePersistence = {
  saveSession(session: ResumeSession): void | Promise<void>;
  loadSession(resumeToken: string): ResumeSession | null | Promise<ResumeSession | null>;
  saveSnapshot(campaignId: string, snapshot: RuntimeSnapshot): void | Promise<void>;
  loadSnapshot(campaignId: string): RuntimeSnapshot | null | Promise<RuntimeSnapshot | null>;
  saveCommandReceipt(receipt: CommandReceipt): void | Promise<void>;
  loadCommandReceipt(requestId: string, campaignId?: string): CommandReceipt | null | Promise<CommandReceipt | null>;
  appendEvents(events: readonly DomainEvent[]): void | Promise<void>;
  loadEvents(campaignId: string, fromSequence?: number): readonly DomainEvent[] | Promise<readonly DomainEvent[]>;
};

export class InMemoryAuthProvider implements AuthProvider {
  constructor(private readonly tokens: ReadonlyMap<string, AuthIdentity>) {}
  authenticate(token: string): AuthIdentity | null {
    return this.tokens.get(token) ?? null;
  }
}

export class InMemoryCampaignMembershipStore implements CampaignMembershipStore {
  constructor(private readonly memberships: readonly CampaignMembership[]) {}
  canJoin(identity: AuthIdentity, membership: { campaignId: string; role: "gm" | "player"; actorId?: string }): boolean {
    return this.memberships.some((candidate) => candidate.campaignId === membership.campaignId && candidate.identityId === identity.id && candidate.role === membership.role && (candidate.actorId === undefined || candidate.actorId === membership.actorId));
  }
}

export class InMemorySlicePersistence implements SlicePersistence {
  private readonly sessions = new Map<string, ResumeSession>();
  private readonly snapshots = new Map<string, RuntimeSnapshot>();
  private readonly receipts = new Map<string, CommandReceipt>();
  private readonly events: DomainEvent[] = [];

  saveSession(session: ResumeSession): void { this.sessions.set(session.resumeToken, structuredClone(session)); }
  loadSession(resumeToken: string): ResumeSession | null { return structuredClone(this.sessions.get(resumeToken) ?? null); }
  saveSnapshot(campaignId: string, snapshot: RuntimeSnapshot): void { this.snapshots.set(campaignId, structuredClone(snapshot)); }
  loadSnapshot(campaignId: string): RuntimeSnapshot | null { return structuredClone(this.snapshots.get(campaignId) ?? null); }

  saveCommandReceipt(receipt: CommandReceipt): void {
    const key = `${receipt.campaignId}:${receipt.requestId}`;
    const clone = structuredClone(receipt);
    this.receipts.set(key, clone);
    this.receipts.set(receipt.requestId, clone);
  }
  loadCommandReceipt(requestIdOrCampaignId: string, campaignIdOrRequestId?: string): CommandReceipt | null {
    if (campaignIdOrRequestId) {
      const composite1 = `${campaignIdOrRequestId}:${requestIdOrCampaignId}`;
      const composite2 = `${requestIdOrCampaignId}:${campaignIdOrRequestId}`;
      const candidate = this.receipts.get(composite1) ?? this.receipts.get(composite2);
      if (candidate) return structuredClone(candidate);
    }
    const candidate = this.receipts.get(requestIdOrCampaignId) ?? (campaignIdOrRequestId ? this.receipts.get(campaignIdOrRequestId) : undefined);
    return candidate ? structuredClone(candidate) : null;
  }
  saveCommandRequest(receipt: CommandReceipt): void {
    this.saveCommandReceipt(receipt);
  }
  loadCommandRequest(requestId: string, campaignId?: string): CommandReceipt | null {
    return this.loadCommandReceipt(requestId, campaignId);
  }

  appendEvents(events: readonly DomainEvent[]): void {
    for (const event of events) {
      this.events.push(structuredClone(event));
    }
  }
  appendEvent(event: DomainEvent): void {
    this.appendEvents([event]);
  }
  loadEvents(campaignId: string, fromSequence = 0): readonly DomainEvent[] {
    return this.events
      .filter((event) => event.campaignId === campaignId && (event.serverSequence ?? 0) >= fromSequence)
      .map((event) => structuredClone(event));
  }
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private updatedAt: number;
  constructor(private readonly capacity = 20, private readonly refillPerSecond = 10, now = Date.now()) {
    if (capacity < 1 || refillPerSecond <= 0) throw new RangeError("Invalid rate limit configuration");
    this.tokens = capacity;
    this.updatedAt = now;
  }
  consume(now = Date.now()): boolean {
    const elapsedSeconds = Math.max(0, now - this.updatedAt) / 1_000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
