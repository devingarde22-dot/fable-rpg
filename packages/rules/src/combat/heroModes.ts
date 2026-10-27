import type { EntityId, HeroMode, HeroRuntime, ModeChangedValue, RuntimeState } from "../engine/types.js";
import { CARD_ROTATION_INTERVAL_TICKS } from "../engine/types.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";

export type EventCause = { requestId: string | null; actorId: string | null };

export function contactingEnemies(state: RuntimeState, hero: HeroRuntime): EntityId[] {
  return state.scene.enemyEntityIds
    .filter((enemyId) => {
      const enemy = state.entities.get(enemyId);
      if (!enemy || enemy.kind !== "enemy" || enemy.aliveState !== "active" || enemy.hp.current === 0) return false;
      const distance = Math.max(
        Math.abs(hero.position.x - enemy.position.x),
        Math.abs(hero.position.y - enemy.position.y),
      );
      return distance === 1;
    })
    .sort(compareText);
}

export function detectContactTransitions(
  state: RuntimeState,
  serverTick: number,
  cause: EventCause = { requestId: null, actorId: null },
): PendingJournalEvent[] {
  const pending: PendingJournalEvent[] = [];
  const heroes = state.scene.playerEntityIds
    .map((heroId) => state.entities.get(heroId))
    .filter((entity): entity is HeroRuntime => entity?.kind === "hero")
    .sort((a, b) => compareText(a.id, b.id));

  for (const hero of heroes) {
    if (hero.aliveState !== "active" || hero.mode === "melee" || contactingEnemies(state, hero).length === 0) continue;
    const immunityExpiry = state.scene.contactImmunityUntilTick.get(hero.id);
    if (immunityExpiry !== undefined && serverTick < immunityExpiry) continue;

    const previousMode = hero.mode;
    hero.mode = "melee";
    if (previousMode === null || previousMode === "movement") {
      hero.cards.nextHandRotationAtTick = serverTick + CARD_ROTATION_INTERVAL_TICKS;
    }
    pending.push(modeChangedEvent(state, hero, previousMode, "melee", "contact", serverTick, cause));
  }
  return pending;
}

export function modeChangedEvent(
  state: RuntimeState,
  hero: HeroRuntime,
  from: HeroMode | null,
  to: HeroMode | null,
  reason: "command" | "contact" | "retreat" | "scene_end" | "rollback",
  serverTick: number,
  cause: EventCause,
): PendingJournalEvent {
  return {
    event: {
      ...eventBase(state, serverTick, cause.actorId, cause.requestId),
      eventType: "mode.changed",
      payload: {
        heroId: hero.id,
        from: toEventMode(from),
        to: toEventMode(to),
        reason,
      },
      replay: null,
    },
  };
}

export function modeFromEvent(value: ModeChangedValue): HeroMode | null {
  return value === "out_of_combat" ? null : value;
}

function toEventMode(mode: HeroMode | null): ModeChangedValue {
  return mode ?? "out_of_combat";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
