import type { RuntimeSnapshot } from "../../rules/src/index.js";

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
export type SlicePersistence = {
  saveSession(session: ResumeSession): void | Promise<void>;
  loadSession(resumeToken: string): ResumeSession | null | Promise<ResumeSession | null>;
  saveSnapshot(campaignId: string, snapshot: RuntimeSnapshot): void | Promise<void>;
  loadSnapshot(campaignId: string): RuntimeSnapshot | null | Promise<RuntimeSnapshot | null>;
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
  saveSession(session: ResumeSession): void { this.sessions.set(session.resumeToken, structuredClone(session)); }
  loadSession(resumeToken: string): ResumeSession | null { return structuredClone(this.sessions.get(resumeToken) ?? null); }
  saveSnapshot(campaignId: string, snapshot: RuntimeSnapshot): void { this.snapshots.set(campaignId, structuredClone(snapshot)); }
  loadSnapshot(campaignId: string): RuntimeSnapshot | null { return structuredClone(this.snapshots.get(campaignId) ?? null); }
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
