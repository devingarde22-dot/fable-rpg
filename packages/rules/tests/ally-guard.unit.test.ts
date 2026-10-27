import { describe, expect, it } from "vitest";
import { calculateDamage, effectiveDefense } from "../src/combat/damage.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { applyAllyGuard } from "../src/statuses/statusSystem.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

describe("Ally Guard status lifecycle", () => {
  it("applies 20% potency, does not round effective defense, and expires after its due tick", () => {
    const state = createRuntimeState(testConfig({
      entities: [
        hero("hero-1", 0, 0),
        enemy("guard-source", 1, 1, "extinguisher"),
        enemy("guard-target", 2, 1, "slag_shooter"),
      ],
      initialIntentByEnemyId: {},
    }));
    const source = state.entities.get("guard-source");
    const target = state.entities.get("guard-target");
    if (!source || source.kind !== "enemy" || !target || target.kind !== "enemy") throw new Error("guard fixture missing");

    const applied = applyAllyGuard(state, target, source, "intent-guard-1", 5, 20, 15_000);
    expect(applied.event).toMatchObject({
      eventType: "status.applied",
      actorId: "guard-source",
      payload: {
        entityId: "guard-target",
        statusKey: "ally_guard",
        publicPotency: 20,
        timer: { startedAtTick: 5, resolvesAtTick: 305, durationMs: 15_000, remainingMs: 15_000, paused: false },
      },
    });
    expect(target.statuses).toEqual([{
      id: "status:guard-target:ally_guard:guard-source:intent-guard-1",
      templateKey: "ally_guard",
      sourceEntityId: "guard-source",
      potency: 20,
      stacks: 1,
      appliedAtTick: 5,
      expiresAtTick: 305,
      refreshPolicy: "refresh_duration",
    }]);
    expect(effectiveDefense(target, 305)).toBe(target.defense * 1.2);
    expect(effectiveDefense(target, 306)).toBe(target.defense);

    const result = calculateDamage({ rawDamage: 37, defense: effectiveDefense(target, 10), multiplier: 1 });
    expect(result.defense).toBe(12 * 1.2);
    expect(result.mitigatedDamage).toBe(33);
    expect(calculateDamage({ rawDamage: 37, defense: 12, multiplier: 1 }).mitigatedDamage).toBe(34);
    expect(target.defense).toBe(12);
  });

  it("refreshes the same layer without changing its source, potency, stacks, or refresh policy", () => {
    const state = createRuntimeState(testConfig({
      entities: [
        hero("hero-1", 0, 0),
        enemy("guard-source-a", 1, 1, "extinguisher"),
        enemy("guard-source-b", 2, 1, "extinguisher"),
        enemy("guard-target", 3, 1, "slag_shooter"),
      ],
      initialIntentByEnemyId: {},
    }));
    const sourceA = state.entities.get("guard-source-a");
    const sourceB = state.entities.get("guard-source-b");
    const target = state.entities.get("guard-target");
    if (!sourceA || sourceA.kind !== "enemy" || !sourceB || sourceB.kind !== "enemy" ||
      !target || target.kind !== "enemy") throw new Error("guard refresh fixtures missing");

    applyAllyGuard(state, target, sourceA, "intent-guard-first", 10, 20, 15_000);
    const first = structuredClone(target.statuses[0]);
    const refreshed = applyAllyGuard(state, target, sourceB, "intent-guard-refresh", 40, 20, 15_000);

    expect(refreshed.event).toMatchObject({
      eventType: "status.refreshed",
      actorId: "guard-source-b",
      payload: {
        entityId: "guard-target",
        statusKey: "ally_guard",
        layerId: first?.id,
        publicPotency: 20,
        timer: { startedAtTick: 40, resolvesAtTick: 340 },
      },
    });
    expect(target.statuses).toEqual([{
      ...first,
      appliedAtTick: 40,
      expiresAtTick: 340,
    }]);
    expect(target.statuses).toHaveLength(1);
  });
});
