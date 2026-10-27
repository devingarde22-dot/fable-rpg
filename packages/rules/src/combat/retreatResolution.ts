import type { HeroRuntime, RuntimeState } from "../engine/types.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";
import { contactingEnemies, modeChangedEvent } from "./heroModes.js";

export type RetreatAttackResult = {
  enemyId: string;
  attackOrder: number;
  coefficient: number;
  rawDamage: number;
  mitigation: number;
  mitigatedDamage: number;
  finalDamage: number;
  hpBefore: number;
  hpAfter: number;
};

export type RetreatResolution = {
  events: PendingJournalEvent[];
  attacks: RetreatAttackResult[];
};

export function resolveRetreat(
  state: RuntimeState,
  hero: HeroRuntime,
  serverTick: number,
  requestId: string,
  actorId: string,
): RetreatResolution {
  if (hero.mode !== "melee") throw new Error("Retreat resolution requires melee mode");

  const events: PendingJournalEvent[] = [];
  const attacks: RetreatAttackResult[] = [];
  const enemies = contactingEnemies(state, hero);

  enemies.forEach((enemyId, index) => {
    const enemy = state.entities.get(enemyId);
    if (!enemy || enemy.kind !== "enemy") throw new Error(`Retreat enemy ${enemyId} is missing`);
    const template = state.enemyTemplates.get(enemy.templateKey);
    if (!template) throw new Error(`Retreat enemy ${enemyId} has no registered template`);

    const attackOrder = index + 1;
    const coefficient = 1 / attackOrder;
    const rawDamage = template.basicAttack.rawDamage;
    const mitigation = 100 / (100 + hero.defense);
    const mitigatedDamage = Math.ceil(rawDamage * mitigation);
    const finalDamage = Math.ceil(mitigatedDamage * coefficient);
    const hpBefore = hero.hp.current;
    const hpAfter = Math.max(0, hpBefore - finalDamage);

    attacks.push({ enemyId, attackOrder, coefficient, rawDamage, mitigation, mitigatedDamage, finalDamage, hpBefore, hpAfter });
    hero.hp.current = hpAfter;
    if (hpAfter === 0) hero.aliveState = "critically_injured";

    if (hpAfter !== hpBefore) {
      events.push({
        event: {
          ...eventBase(state, serverTick, enemy.id, requestId),
          eventType: "hp.changed",
          payload: { entityId: hero.id, current: hpAfter, maximum: hero.hp.max, kind: "damage", publicAmount: finalDamage },
          replay: null,
        },
      });
    }
  });

  state.scene.contactImmunityUntilTick.set(hero.id, serverTick + 300);
  const previousMode = hero.mode;
  hero.mode = "movement";
  events.push(modeChangedEvent(state, hero, previousMode, hero.mode, "retreat", serverTick, { requestId, actorId }));

  return { events, attacks };
}
