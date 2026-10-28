import type { DomainEvent, InputWindowRuntime, JournalRecord, RngAuditRecord } from "../engine/types.js";

export class EventJournal {
  private readonly recordsStore: JournalRecord[] = [];
  private lastServerSequence = 0;
  private lastServerTick: number | null = null;
  private lastSceneRevision = 0;

  appendBatch(events: readonly DomainEvent[], auditByEventId: ReadonlyMap<string, readonly RngAuditRecord[]> = new Map()): void {
    let expected = this.lastServerSequence;
    for (const event of events) {
      if (event.serverSequence <= expected) throw new Error("Journal serverSequence must increase strictly");
      expected = event.serverSequence;
    }
    for (const event of events) {
      this.recordsStore.push({
        kind: "event",
        event: cloneEvent(event),
        rngAudit: (auditByEventId.get(event.eventId) ?? []).map(cloneAuditRecord),
      });
      this.lastServerSequence = event.serverSequence;
      this.lastSceneRevision = event.sceneRevision;
    }
  }

  appendInputWindow(serverTick: number, inputWindow: InputWindowRuntime): void {
    if (!Number.isInteger(serverTick) || serverTick < 0) throw new Error("Journal input-window tick must be non-negative");
    this.recordsStore.push({ kind: "input_window", serverTick, inputWindow: cloneInputWindow(inputWindow) });
  }

  appendTick(serverTick: number, sceneRevision: number, inputWindow: InputWindowRuntime): void {
    if (!Number.isInteger(serverTick) || serverTick < 0) throw new Error("Journal tick must be a non-negative integer");
    if (this.lastServerTick !== null && serverTick !== this.lastServerTick + 1) {
      throw new Error("Journal tick marks must be strictly consecutive");
    }
    if (sceneRevision < this.lastSceneRevision) throw new Error("Journal sceneRevision cannot move backwards");
    this.recordsStore.push({ kind: "tick", serverTick, sceneRevision, inputWindow: cloneInputWindow(inputWindow) });
    this.lastServerTick = serverTick;
    this.lastSceneRevision = sceneRevision;
  }

  appendPause(paused: boolean, serverTick: number, sceneRevision: number): void {
    if (!Number.isInteger(serverTick) || serverTick < 0) throw new Error("Journal pause tick must be a non-negative integer");
    if (!Number.isInteger(sceneRevision) || sceneRevision < 0) throw new Error("Journal pause revision must be a non-negative integer");
    this.recordsStore.push({ kind: "pause", paused, serverTick, sceneRevision });
  }

  events(): readonly DomainEvent[] {
    return this.recordsStore.flatMap((record) => record.kind === "event" ? [cloneEvent(record.event)] : []);
  }

  records(): readonly JournalRecord[] {
    return this.recordsStore.map((record) => {
      if (record.kind === "event") {
        return { kind: "event", event: cloneEvent(record.event), rngAudit: record.rngAudit.map(cloneAuditRecord) };
      }
      if (record.kind === "tick") {
        return { ...record, inputWindow: cloneInputWindow(record.inputWindow) };
      }
      if (record.kind === "pause") return { ...record };
      return { ...record, inputWindow: cloneInputWindow(record.inputWindow) };
    });
  }

  get length(): number {
    return this.recordsStore.filter((record) => record.kind === "event").length;
  }

  get recordCount(): number {
    return this.recordsStore.length;
  }
}

export function cloneEvent(event: DomainEvent): DomainEvent {
  return structuredClone(event);
}

function cloneInputWindow(inputWindow: InputWindowRuntime): InputWindowRuntime {
  return {
    windowId: inputWindow.windowId,
    commands: inputWindow.commands.map((command) => structuredClone(command)),
  };
}

function cloneAuditRecord(record: RngAuditRecord): RngAuditRecord {
  return {
    ...record,
    forkInput: { ...record.forkInput },
    rngStateBefore: [...record.rngStateBefore] as RngAuditRecord["rngStateBefore"],
    rngStateAfter: [...record.rngStateAfter] as RngAuditRecord["rngStateAfter"],
  };
}
