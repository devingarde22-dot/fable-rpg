import { describe, expect, it } from "vitest";
import { detectContactTransitions, contactingEnemies } from "../src/combat/heroModes.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { assertRuntimeInvariants } from "../src/engine/invariants.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

describe("melee contact detector", () => {
  it.each([
    ["orthogonal", 2, 3],
    ["diagonal", 3, 3],
  ] as const)("treats %s adjacency as contact", (_label, enemyX, enemyY) => {
    const state = createRuntimeState(testConfig({
      entities: [hero("hero-1", 2, 2), enemy("enemy-1", enemyX, enemyY)],
    }));
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("hero fixture missing");

    expect(contactingEnemies(state, heroRuntime)).toEqual(["enemy-1"]);
    const events = detectContactTransitions(state, 0);
    expect(events).toHaveLength(1);
    expect(heroRuntime.mode).toBe("melee");
    expect(events[0]?.event).toMatchObject({
      eventType: "mode.changed",
      payload: { heroId: "hero-1", from: "movement", to: "melee", reason: "contact" },
    });
    assertRuntimeInvariants(state);
  });

  it("does not treat cells beyond one Chebyshev step or inactive enemies as contact", () => {
    const inactiveEnemy = { ...enemy("enemy-1", 3, 2), aliveState: "critically_injured" as const };
    const state = createRuntimeState(testConfig({
      entities: [hero("hero-1", 1, 1), inactiveEnemy],
    }));
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("hero fixture missing");
    expect(contactingEnemies(state, heroRuntime)).toEqual([]);
    expect(detectContactTransitions(state, 0)).toEqual([]);
    expect(heroRuntime.mode).toBe("movement");
  });

  it("blocks contact while serverTick is before immunity expiry and allows it exactly at expiry", () => {
    const state = createRuntimeState(testConfig({
      entities: [hero("hero-1", 2, 2), enemy("enemy-1", 3, 3)],
    }));
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("hero fixture missing");
    state.scene.contactImmunityUntilTick.set(heroRuntime.id, 100);

    expect(detectContactTransitions(state, 99)).toEqual([]);
    expect(heroRuntime.mode).toBe("movement");
    expect(detectContactTransitions(state, 100)).toHaveLength(1);
    expect(heroRuntime.mode).toBe("melee");
  });

  it("returns multiple contacting enemies in ascending entity-id order", () => {
    const state = createRuntimeState(testConfig({
      entities: [
        hero("hero-1", 2, 2),
        enemy("enemy-z", 1, 2),
        enemy("enemy-a", 3, 3, "slag_shooter"),
      ],
    }));
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("hero fixture missing");
    expect(contactingEnemies(state, heroRuntime)).toEqual(["enemy-a", "enemy-z"]);
  });
});
