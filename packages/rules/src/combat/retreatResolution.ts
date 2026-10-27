import type { HeroRuntime, RuntimeState } from "../engine/types.js";
import type { PendingJournalEvent } from "../intents/events.js";
import { applyDamage } from "./damage.js";
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
    const result = applyDamage(state, {
      target: hero,
      source: { kind: "retreat_attack", enemyId, attackOrder },
      rawDamage,
      multiplier: coefficient,
      serverTick,
      causedByRequestId: requestId,
    });

    attacks.push({
      enemyId,
      attackOrder,
      coefficient,
      rawDamage,
      mitigation: result.calculation.mitigation,
      mitigatedDamage: result.calculation.mitigatedDamage,
      finalDamage: result.calculation.finalDamage,
      hpBefore: result.hpBefore,
      hpAfter: result.hpAfter,
    });
    if (result.event) events.push(result.event);
  });

  state.scene.contactImmunityUntilTick.set(hero.id, serverTick + 300);
  const previousMode = hero.mode;
  hero.mode = "movement";
  events.push(modeChangedEvent(state, hero, previousMode, hero.mode, "retreat", serverTick, { requestId, actorId }));

  return { events, attacks };
}
