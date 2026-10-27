import { describe, expect, it } from "vitest";
import { applyDamage, calculateDamage } from "../src/combat/damage.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

describe("fable.damage.v1", () => {
  it("uses staged ceilings and does not round a fractional multiplier first", () => {
    expect(calculateDamage({ rawDamage: 140, defense: 20, multiplier: 1 })).toMatchObject({
      mitigation: 100 / 120,
      mitigatedDamage: 117,
      finalDamage: 117,
    });
    expect(calculateDamage({ rawDamage: 140, defense: 20, multiplier: 1 / 3 })).toMatchObject({
      mitigatedDamage: 117,
      finalDamage: 39,
    });
  });

  it("rounds after mitigation and again after multiplier", () => {
    const result = calculateDamage({ rawDamage: 25, defense: 0, multiplier: 0.5 });
    expect(result).toMatchObject({ mitigation: 1, mitigatedDamage: 25, finalDamage: 13 });
  });

  it("clamps HP at zero and emits hp.changed v2 with source and formula values", () => {
    const state = createRuntimeState(testConfig({
      entities: [{ ...hero("hero-1", 1, 1), hp: { current: 10, max: 1_000 } }, enemy("enemy-1", 7, 7)],
    }));
    const target = state.entities.get("hero-1");
    if (!target || target.kind !== "hero") throw new Error("hero fixture missing");

    const result = applyDamage(state, {
      target,
      source: { kind: "enemy_intent", enemyId: "enemy-1", activeIntentId: "intent-1", handler: "melee_strike" },
      rawDamage: 140,
      multiplier: 1,
      serverTick: 12,
      causedByRequestId: null,
    });

    expect(result).toMatchObject({ hpBefore: 10, hpAfter: 0, appliedDamage: 10, calculation: { finalDamage: 117 } });
    expect(target).toMatchObject({ hp: { current: 0, max: 1_000 }, aliveState: "critically_injured" });
    expect(result.event?.event).toMatchObject({
      eventType: "hp.changed",
      eventVersion: 2,
      payload: {
        entityId: "hero-1",
        current: 0,
        maximum: 1_000,
        kind: "damage",
        publicAmount: 117,
        source: { kind: "enemy_intent", enemyId: "enemy-1", activeIntentId: "intent-1", handler: "melee_strike" },
        formulaVersion: "fable.damage.v1",
        rawDamage: 140,
        defense: 20,
        multiplier: 1,
        finalDamage: 117,
      },
    });
  });

  it("continues a later retreat attack at zero HP without a duplicate HP event", () => {
    const state = createRuntimeState(testConfig({
      entities: [{ ...hero("hero-1", 1, 1), hp: { current: 1, max: 1_000 } }, enemy("enemy-1", 7, 7)],
    }));
    const target = state.entities.get("hero-1");
    if (!target || target.kind !== "hero") throw new Error("hero fixture missing");
    applyDamage(state, {
      target,
      source: { kind: "enemy_intent", enemyId: "enemy-1", activeIntentId: "intent-1", handler: "melee_strike" },
      rawDamage: 140,
      multiplier: 1,
      serverTick: 1,
      causedByRequestId: null,
    });
    const later = applyDamage(state, {
      target,
      source: { kind: "retreat_attack", enemyId: "enemy-1", attackOrder: 2 },
      rawDamage: 100,
      multiplier: 0.5,
      serverTick: 1,
      causedByRequestId: "retreat-1",
    });

    expect(later).toMatchObject({ hpBefore: 0, hpAfter: 0, appliedDamage: 0, calculation: { finalDamage: 42 }, event: null });
    expect(target).toMatchObject({ hp: { current: 0 }, aliveState: "critically_injured" });
  });

  it("rejects negative, infinite, or NaN formula inputs", () => {
    expect(() => calculateDamage({ rawDamage: -1, defense: 0, multiplier: 1 })).toThrow(/rawDamage/);
    expect(() => calculateDamage({ rawDamage: 1, defense: Number.POSITIVE_INFINITY, multiplier: 1 })).toThrow(/defense/);
    expect(() => calculateDamage({ rawDamage: 1, defense: 0, multiplier: Number.NaN })).toThrow(/multiplier/);
  });
});
