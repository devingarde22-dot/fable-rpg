import { describe, expect, it } from "vitest";
import { resolveRetreat } from "../src/combat/retreatResolution.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { assertRuntimeInvariants } from "../src/engine/invariants.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

describe("retreat attack resolution", () => {
  it("uses sorted enemy IDs, 1/order coefficients, two-stage ceiling and continues after 0 HP", () => {
    const config = testConfig({
      entities: [
        { ...hero("hero-1", 4, 4, "melee"), hp: { current: 150, max: 1_000 } },
        enemy("enemy-d", 4, 5),
        enemy("enemy-b", 5, 4),
        enemy("enemy-c", 4, 3),
        enemy("enemy-a", 3, 4, "slag_shooter"),
      ],
    });
    const state = createRuntimeState(config);
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("hero fixture missing");

    const result = resolveRetreat(state, heroRuntime, 300, "retreat-1", "actor-1");
    expect(result.attacks.map(({ enemyId, attackOrder, coefficient, rawDamage, mitigatedDamage, finalDamage, hpBefore, hpAfter }) => ({
      enemyId, attackOrder, coefficient, rawDamage, mitigatedDamage, finalDamage, hpBefore, hpAfter,
    }))).toEqual([
      { enemyId: "enemy-a", attackOrder: 1, coefficient: 1, rawDamage: 100, mitigatedDamage: 84, finalDamage: 84, hpBefore: 150, hpAfter: 66 },
      { enemyId: "enemy-b", attackOrder: 2, coefficient: 0.5, rawDamage: 140, mitigatedDamage: 117, finalDamage: 59, hpBefore: 66, hpAfter: 7 },
      { enemyId: "enemy-c", attackOrder: 3, coefficient: 1 / 3, rawDamage: 140, mitigatedDamage: 117, finalDamage: 39, hpBefore: 7, hpAfter: 0 },
      { enemyId: "enemy-d", attackOrder: 4, coefficient: 0.25, rawDamage: 140, mitigatedDamage: 117, finalDamage: 30, hpBefore: 0, hpAfter: 0 },
    ]);
    expect(result.events.map(({ event }) => event.eventType)).toEqual([
      "hp.changed",
      "hp.changed",
      "hp.changed",
      "mode.changed",
    ]);
    expect(result.events[0]?.event).toMatchObject({
      eventType: "hp.changed",
      eventVersion: 2,
      payload: {
        source: { kind: "retreat_attack", enemyId: "enemy-a", attackOrder: 1 },
        formulaVersion: "fable.damage.v1",
        rawDamage: 100,
        defense: 20,
        multiplier: 1,
        finalDamage: 84,
      },
    });
    expect(result.events[0]?.event.actorId).toBe("enemy-a");
    expect(result.events.some(({ event }) => String(event.eventType).startsWith("status."))).toBe(false);
    expect(result.events.at(-1)?.event).toMatchObject({
      eventType: "mode.changed",
      payload: { heroId: "hero-1", from: "melee", to: "movement", reason: "retreat" },
    });
    expect(heroRuntime.hp.current).toBe(0);
    expect(heroRuntime.aliveState).toBe("critically_injured");
    expect(heroRuntime.mode).toBe("movement");
    expect(state.scene.contactImmunityUntilTick.get("hero-1")).toBe(600);
    assertRuntimeInvariants(state);
  });

  it("emits no duplicate hp.changed event when a later attack cannot further reduce HP", () => {
    const state = createRuntimeState(testConfig({
      entities: [
        { ...hero("hero-1", 4, 4, "melee"), hp: { current: 1, max: 1_000 } },
        enemy("enemy-a", 3, 4),
        enemy("enemy-b", 5, 4, "slag_shooter"),
      ],
    }));
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("hero fixture missing");
    const result = resolveRetreat(state, heroRuntime, 5, "retreat-zero", "actor-1");
    expect(result.attacks).toHaveLength(2);
    expect(result.events.filter(({ event }) => event.eventType === "hp.changed")).toHaveLength(1);
    expect(heroRuntime.hp.current).toBe(0);
    expect(heroRuntime.aliveState).toBe("critically_injured");
  });
});
