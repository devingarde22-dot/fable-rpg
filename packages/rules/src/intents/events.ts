import type { DomainEvent, RngAuditRecord, RuntimeState } from "../engine/types.js";

export type PendingDomainEvent = DomainEvent extends infer Event
  ? Event extends DomainEvent
    ? Omit<Event, "eventId" | "eventGroupId" | "eventIndex" | "serverSequence" | "sceneRevision">
    : never
  : never;

type EventDefinitionFor<Event extends DomainEvent> = Omit<
  Event,
  | "protocolVersion"
  | "schemaVersion"
  | "eventId"
  | "eventVersion"
  | "campaignId"
  | "sessionId"
  | "sceneId"
  | "sceneRevision"
  | "serverTick"
  | "serverSequence"
  | "eventGroupId"
  | "eventIndex"
  | "causedByRequestId"
  | "actorId"
>;
export type EventDefinition = DomainEvent extends infer Event
  ? Event extends DomainEvent
    ? EventDefinitionFor<Event>
    : never
  : never;

export type PendingJournalEvent = {
  event: PendingDomainEvent;
  rngAudit?: readonly RngAuditRecord[];
};

export function eventBase(state: RuntimeState, serverTick: number, actorId: string | null, causedByRequestId: string | null) {
  return {
    protocolVersion: "fable.protocol.v1" as const,
    schemaVersion: 1 as const,
    eventVersion: 1 as const,
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    sceneId: state.scene.id,
    serverTick,
    causedByRequestId,
    actorId,
  };
}

export function groupEvents(
  state: RuntimeState,
  pending: readonly PendingJournalEvent[],
): { events: DomainEvent[]; auditByEventId: Map<string, readonly RngAuditRecord[]> } {
  if (pending.length === 0) return { events: [], auditByEventId: new Map() };
  state.sceneRevision += 1;
  const revision = state.sceneRevision;
  const groupId = `scene-${revision}`;
  const auditByEventId = new Map<string, readonly RngAuditRecord[]>();
  const events = pending.map(({ event, rngAudit }, eventIndex) => {
    const serverSequence = state.nextServerSequence;
    state.nextServerSequence += 1;
    const eventId = `evt-${serverSequence}`;
    if (rngAudit && rngAudit.length > 0) auditByEventId.set(eventId, rngAudit);
    return {
      ...event,
      eventId,
      eventGroupId: groupId,
      eventIndex,
      serverSequence,
      sceneRevision: revision,
    } as DomainEvent;
  });
  return { events, auditByEventId };
}
