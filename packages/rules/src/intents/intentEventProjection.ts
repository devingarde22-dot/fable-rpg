import type { Cell, DomainEvent } from "../engine/types.js";

export type TargetSelectedProjection = {
  eventId: string;
  eventType: "intent.target_selected";
  serverTick: number;
  sceneRevision: number;
  payload: {
    activeIntentId: string;
    enemyId: string;
    targetCell?: Cell;
  };
};

/**
 * The raw domain event is GM/audit data. Public callers must explicitly supply
 * a target cell already approved by the intent's visibility/reveal policy.
 */
export function projectTargetSelectedEvent(
  event: Extract<DomainEvent, { eventType: "intent.target_selected" }>,
  audience: "tv" | "player" | "gm",
  approvedPublicTargetCell: Cell | null = null,
): TargetSelectedProjection | Extract<DomainEvent, { eventType: "intent.target_selected" }> {
  if (audience === "gm") return structuredClone(event);
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    serverTick: event.serverTick,
    sceneRevision: event.sceneRevision,
    payload: {
      activeIntentId: event.payload.activeIntentId,
      enemyId: event.payload.enemyId,
      ...(approvedPublicTargetCell ? { targetCell: { ...approvedPublicTargetCell } } : {}),
    },
  };
}
