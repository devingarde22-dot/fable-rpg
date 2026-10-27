import { STAMINA_REGEN_INTERVAL_TICKS, type HeroRuntime, type RuntimeState } from "../engine/types.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";

/** Returns whether a non-negative integer stamina cost can be paid from the current resource value. */
export function canAffordStamina(current: number, cost: number): boolean {
  return Number.isInteger(current) && current >= 0 &&
    Number.isInteger(cost) && cost >= 0 && cost <= current;
}

/** Advances due stamina timers once per authoritative tick and emits canonical resource events. */
export function resolveStaminaRegeneration(state: RuntimeState, serverTick: number): PendingJournalEvent[] {
  const pending: PendingJournalEvent[] = [];
  const heroes = state.scene.playerEntityIds
    .map((heroId) => state.entities.get(heroId))
    .filter((entity): entity is HeroRuntime => entity?.kind === "hero")
    .sort((a, b) => compareText(a.id, b.id));

  for (const hero of heroes) {
    const dueAtTick = hero.stamina.nextRegenAtTick;
    if (dueAtTick === null || serverTick < dueAtTick) continue;
    if (serverTick !== dueAtTick) {
      throw new Error(`Hero ${hero.id} stamina regeneration timer was skipped`);
    }

    // Inactive heroes have no running timer; this guard also keeps regeneration from mutating them.
    if (hero.aliveState !== "active" || hero.stamina.current >= hero.stamina.max) {
      hero.stamina.nextRegenAtTick = null;
      continue;
    }

    hero.stamina.current += 1;
    hero.stamina.nextRegenAtTick = hero.stamina.current < hero.stamina.max
      ? dueAtTick + STAMINA_REGEN_INTERVAL_TICKS
      : null;
    pending.push({
      event: {
        ...eventBase(state, serverTick, null, null),
        eventType: "stamina.changed",
        payload: {
          heroId: hero.id,
          current: hero.stamina.current,
          maximum: hero.stamina.max,
          reason: "regeneration",
        },
        replay: null,
      },
    });
  }

  return pending;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
