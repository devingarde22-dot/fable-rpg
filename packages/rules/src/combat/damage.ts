import { DAMAGE_FORMULA_VERSION, type DamageSource, type EntityRuntime, type RuntimeState } from "../engine/types.js";
import { eventBaseV2, type PendingJournalEvent } from "../intents/events.js";

export type DamageCalculationInput = {
  rawDamage: number;
  defense: number;
  multiplier: number;
};

export type DamageCalculation = DamageCalculationInput & {
  mitigation: number;
  mitigatedDamage: number;
  finalDamage: number;
};

export type ApplyDamageInput = {
  target: EntityRuntime;
  source: DamageSource;
  rawDamage: number;
  multiplier: number;
  serverTick: number;
  causedByRequestId: string | null;
  actorId?: string | null;
};

export type ApplyDamageResult = {
  calculation: DamageCalculation;
  hpBefore: number;
  hpAfter: number;
  appliedDamage: number;
  event: PendingJournalEvent | null;
};

export function calculateDamage(input: DamageCalculationInput): DamageCalculation {
  assertFiniteNonNegative(input.rawDamage, "rawDamage");
  assertFiniteNonNegative(input.defense, "defense");
  assertFiniteNonNegative(input.multiplier, "multiplier");

  const mitigation = 100 / (100 + input.defense);
  const mitigatedDamage = Math.ceil(input.rawDamage * mitigation);
  const finalDamage = Math.ceil(mitigatedDamage * input.multiplier);
  return { ...input, mitigation, mitigatedDamage, finalDamage };
}

export function effectiveDefense(target: EntityRuntime, serverTick: number): number {
  const guard = target.statuses.find((layer) => layer.templateKey === "ally_guard" && layer.expiresAtTick >= serverTick);
  return guard ? target.defense * (1 + guard.potency / 100) : target.defense;
}

export function applyDamage(state: RuntimeState, input: ApplyDamageInput): ApplyDamageResult {
  if (input.target.aliveState === "removed") throw new Error(`Cannot damage removed entity ${input.target.id}`);
  if (!Number.isInteger(input.target.hp.current) || input.target.hp.current < 0 || input.target.hp.current > input.target.hp.max) {
    throw new Error(`Target ${input.target.id} has invalid HP before damage`);
  }
  validateSource(state, input.source, input.rawDamage, input.multiplier);

  const calculation = calculateDamage({
    rawDamage: input.rawDamage,
    defense: effectiveDefense(input.target, input.serverTick),
    multiplier: input.multiplier,
  });
  const hpBefore = input.target.hp.current;
  const hpAfter = Math.max(0, Math.min(input.target.hp.max, hpBefore - calculation.finalDamage));
  const appliedDamage = hpBefore - hpAfter;
  input.target.hp.current = hpAfter;
  if (input.target.kind === "hero" && hpAfter === 0) {
    input.target.aliveState = "critically_injured";
    input.target.stamina.nextRegenAtTick = null;
    input.target.cards.nextHandRotationAtTick = null;
  }

  const event: PendingJournalEvent | null = appliedDamage === 0
    ? null
    : {
        event: {
          ...eventBaseV2(
            state,
            input.serverTick,
            input.actorId ?? (input.source.kind === "card" ? input.source.heroId : input.source.enemyId),
            input.causedByRequestId,
          ),
          eventType: "hp.changed",
          payload: {
            entityId: input.target.id,
            current: hpAfter,
            maximum: input.target.hp.max,
            kind: "damage",
            publicAmount: calculation.finalDamage,
            source: structuredClone(input.source),
            formulaVersion: DAMAGE_FORMULA_VERSION,
            rawDamage: calculation.rawDamage,
            defense: calculation.defense,
            multiplier: calculation.multiplier,
            finalDamage: calculation.finalDamage,
          },
          replay: null,
        },
      };

  return { calculation, hpBefore, hpAfter, appliedDamage, event };
}

function validateSource(state: RuntimeState, source: DamageSource, rawDamage: number, multiplier: number): void {
  if (source.kind === "card") {
    const hero = state.entities.get(source.heroId);
    const card = hero?.kind === "hero"
      ? hero.cards.hand.find((instance) => instance.instanceId === source.cardInstanceId)
      : undefined;
    const template = state.cardTemplates.get(source.cardTemplateKey);
    if (!hero || hero.kind !== "hero" || hero.aliveState !== "active" || hero.hp.current === 0 ||
      !card || card.templateKey !== source.cardTemplateKey || !template ||
      template.effect.kind !== "direct_damage" || rawDamage !== template.effect.rawDamage ||
      multiplier !== template.effect.multiplier) {
      throw new Error("Card damage source must reference the active hero's card in hand and its configured effect");
    }
    return;
  }
  if (!source.enemyId) throw new Error("Damage source must identify its enemy");
  const sourceEntity = state.entities.get(source.enemyId);
  if (!sourceEntity || sourceEntity.kind !== "enemy" || sourceEntity.aliveState !== "active" || sourceEntity.hp.current === 0) {
    throw new Error("Damage source must reference a living active enemy");
  }
  if (source.kind === "enemy_intent") {
    if (!source.activeIntentId || (source.handler !== "melee_strike" && source.handler !== "ranged_shot") || multiplier !== 1) {
      throw new Error("Enemy intent damage must use its active strike handler and multiplier 1");
    }
    return;
  }
  if (source.kind === "retreat_attack") {
    if (!Number.isInteger(source.attackOrder) || source.attackOrder < 1 || multiplier !== 1 / source.attackOrder) {
      throw new Error("Retreat damage multiplier must equal 1 / attackOrder");
    }
    return;
  }
  const exhaustive: never = source;
  throw new Error(`Unsupported damage source: ${String(exhaustive)}`);
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`);
}
