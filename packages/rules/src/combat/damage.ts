import { DAMAGE_FORMULA_VERSION, type DamageSource, type EntityRuntime, type RuntimeState } from "../engine/types.js";
import { eventBase, eventBaseV2, type PendingJournalEvent } from "../intents/events.js";

export type DamageCalculationInput = { rawDamage: number; defense: number; multiplier: number };
export type DamageCalculation = DamageCalculationInput & { mitigation: number; mitigatedDamage: number; finalDamage: number };
export type ApplyDamageInput = {
  target: EntityRuntime; source: DamageSource; rawDamage: number; multiplier: number;
  serverTick: number; causedByRequestId: string | null; actorId?: string | null;
};
export type ApplyDamageResult = {
  calculation: DamageCalculation; hpBefore: number; hpAfter: number; appliedDamage: number;
  absorbedDamage: number; protectionEvents: PendingJournalEvent[]; event: PendingJournalEvent | null;
};

export function calculateDamage(input: DamageCalculationInput): DamageCalculation {
  assertFiniteNonNegative(input.rawDamage, "rawDamage");
  assertFiniteNonNegative(input.defense, "defense");
  assertFiniteNonNegative(input.multiplier, "multiplier");
  const mitigation = 100 / (100 + input.defense);
  const mitigatedDamage = Math.ceil(input.rawDamage * mitigation);
  return { ...input, mitigation, mitigatedDamage, finalDamage: Math.ceil(mitigatedDamage * input.multiplier) };
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
  const calculation = calculateDamage({ rawDamage: input.rawDamage, defense: effectiveDefense(input.target, input.serverTick), multiplier: input.multiplier });
  const protectionEvents: PendingJournalEvent[] = [];
  let incoming = calculation.finalDamage;
  let absorbedDamage = 0;
  if (input.target.kind === "hero" && input.source.kind !== "card") {
    for (const protection of [...input.target.protections]) {
      if (incoming <= 0) break;
      const protectionIndex = input.target.protections.findIndex((item) => item.id === protection.id);
      if (protectionIndex < 0) continue;
      const incomingDamage = incoming;
      let absorbed: number;
      let remainingAmount = 0;
      if (protection.kind === "prevent_one_attack") {
        absorbed = incoming;
        input.target.protections.splice(protectionIndex, 1);
      } else {
        absorbed = Math.min(incoming, protection.remainingAmount);
        remainingAmount = protection.remainingAmount - absorbed;
        if (remainingAmount === 0) input.target.protections.splice(protectionIndex, 1);
        else protection.remainingAmount = remainingAmount;
      }
      incoming -= absorbed;
      absorbedDamage += absorbed;
      protectionEvents.push({ event: { ...eventBase(state, input.serverTick, input.actorId ?? input.source.enemyId, input.causedByRequestId),
          eventType: "protection.triggered", payload: { heroId: input.target.id, protectionId: protection.id, kind: protection.kind,
          source: structuredClone(input.source), incomingDamage, absorbedDamage: absorbed, remainingDamage: incoming, remainingAmount }, replay: null } });
      if (protection.kind === "damage_barrier" && remainingAmount === 0) {
        protectionEvents.push({ event: { ...eventBase(state, input.serverTick, input.actorId ?? input.source.enemyId, input.causedByRequestId),
          eventType: "protection.expired", payload: { heroId: input.target.id, protectionId: protection.id, kind: "damage_barrier", reason: "barrier_depleted" }, replay: null } });
      }
    }
  }
  const hpBefore = input.target.hp.current;
  const hpAfter = Math.max(0, Math.min(input.target.hp.max, hpBefore - incoming));
  const appliedDamage = hpBefore - hpAfter;
  input.target.hp.current = hpAfter;
  if (input.target.kind === "hero" && hpAfter === 0) {
    input.target.aliveState = "critically_injured";
    input.target.stamina.nextRegenAtTick = null;
    input.target.cards.nextHandRotationAtTick = null;
  }
  const event: PendingJournalEvent | null = appliedDamage === 0 ? null : {
    event: {
      ...eventBaseV2(state, input.serverTick, input.actorId ?? (input.source.kind === "card" ? input.source.heroId : input.source.enemyId), input.causedByRequestId),
      eventType: "hp.changed",
      payload: { entityId: input.target.id, current: hpAfter, maximum: input.target.hp.max, kind: "damage", publicAmount: calculation.finalDamage,
        source: structuredClone(input.source), formulaVersion: DAMAGE_FORMULA_VERSION, rawDamage: calculation.rawDamage,
        defense: calculation.defense, multiplier: calculation.multiplier, finalDamage: calculation.finalDamage,
        ...(absorbedDamage > 0 ? { absorbedAmount: absorbedDamage } : {}) },
      replay: null,
    },
  };
  return { calculation, hpBefore, hpAfter, appliedDamage, absorbedDamage, protectionEvents, event };
}

function validateSource(state: RuntimeState, source: DamageSource, rawDamage: number, multiplier: number): void {
  if (source.kind === "card") {
    const hero = state.entities.get(source.heroId);
    const card = hero?.kind === "hero" ? hero.cards.hand.find((instance) => instance.instanceId === source.cardInstanceId) : undefined;
    const template = state.cardTemplates.get(source.cardTemplateKey);
    if (!hero || hero.kind !== "hero" || hero.aliveState !== "active" || hero.hp.current === 0 || !card ||
      card.templateKey !== source.cardTemplateKey || !template || template.effect.kind !== "direct_damage" ||
      rawDamage !== template.effect.rawDamage || multiplier !== template.effect.multiplier) {
      throw new Error("Card damage source must reference the active hero's direct-damage card in hand");
    }
    return;
  }
  if (!source.enemyId) throw new Error("Damage source must identify its enemy");
  const sourceEntity = state.entities.get(source.enemyId);
  if (!sourceEntity || sourceEntity.kind !== "enemy" || sourceEntity.aliveState !== "active" || sourceEntity.hp.current === 0) {
    throw new Error("Damage source must reference a living active enemy");
  }
  if (source.kind === "enemy_intent") {
    if (!source.activeIntentId || (source.handler !== "melee_strike" && source.handler !== "ranged_shot") || multiplier !== 1) throw new Error("Invalid enemy intent damage source");
    return;
  }
  if (source.kind === "retreat_attack") {
    if (!Number.isInteger(source.attackOrder) || source.attackOrder < 1 || multiplier !== 1 / source.attackOrder) throw new Error("Invalid retreat attack multiplier");
    return;
  }
  const exhaustive: never = source;
  throw new Error(`Unsupported damage source: ${String(exhaustive)}`);
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`);
}
