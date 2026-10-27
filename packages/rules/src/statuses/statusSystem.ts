import { eventBase, type PendingJournalEvent } from "../intents/events.js";
import {
  IMMOBILIZED_DURATION_MS,
  IMMOBILIZED_DURATION_TICKS,
  type EntityRuntime,
  type RuntimeState,
  type StatusLayer,
} from "../engine/types.js";

export function hasActiveStatus(entity: EntityRuntime, statusKey: string, serverTick: number): boolean {
  return entity.statuses.some((layer) => layer.templateKey === statusKey && layer.expiresAtTick >= serverTick);
}

export function applyImmobilized(
  state: RuntimeState,
  target: EntityRuntime,
  source: EntityRuntime,
  activeIntentId: string,
  serverTick: number,
): PendingJournalEvent {
  const existing = target.statuses
    .filter((layer) => layer.templateKey === "immobilized" && layer.expiresAtTick >= serverTick)
    .sort((a, b) => compareText(a.id, b.id))[0];
  const expiresAtTick = serverTick + IMMOBILIZED_DURATION_TICKS;
  const layer: StatusLayer = existing ?? {
    id: `status:${target.id}:immobilized:${source.id}:${activeIntentId}`,
    templateKey: "immobilized",
    sourceEntityId: source.id,
    potency: 1,
    stacks: 1,
    appliedAtTick: serverTick,
    expiresAtTick,
    refreshPolicy: "refresh_duration",
  };
  const eventType = existing ? "status.refreshed" : "status.applied";
  if (existing) {
    existing.appliedAtTick = serverTick;
    existing.expiresAtTick = expiresAtTick;
  } else {
    target.statuses.push(layer);
  }

  return {
    event: {
      ...eventBase(state, serverTick, source.id, null),
      eventType,
      payload: {
        entityId: target.id,
        statusKey: "immobilized",
        layerId: layer.id,
        timer: {
          startedAtTick: serverTick,
          resolvesAtTick: expiresAtTick,
          durationMs: IMMOBILIZED_DURATION_MS,
          remainingMs: IMMOBILIZED_DURATION_MS,
          paused: false,
        },
        publicPotency: 1,
      },
      replay: null,
    },
  };
}

export function resolveDueStatusExpirations(state: RuntimeState, serverTick: number): PendingJournalEvent[] {
  const due = [...state.entities.values()]
    .flatMap((entity) => entity.statuses
      .filter((layer) => layer.expiresAtTick <= serverTick)
      .map((layer) => ({ entity, layer })))
    .sort((a, b) => compareText(a.entity.id, b.entity.id) || compareText(a.layer.id, b.layer.id));

  const pending: PendingJournalEvent[] = [];
  for (const { entity, layer } of due) {
    if (layer.expiresAtTick !== serverTick) {
      throw new Error(`Status ${layer.id} missed expiration tick ${layer.expiresAtTick}`);
    }
    const index = entity.statuses.findIndex((candidate) => candidate.id === layer.id);
    if (index < 0) throw new Error(`Status ${layer.id} disappeared before expiration`);
    entity.statuses.splice(index, 1);
    pending.push({
      event: {
        ...eventBase(state, serverTick, null, null),
        eventType: "status.expired",
        payload: { entityId: entity.id, statusKey: layer.templateKey, layerId: layer.id },
        replay: null,
      },
    });
  }
  return pending;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
