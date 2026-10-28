import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

describe("Extinguisher bind uptime", () => {
  it("leaves at least one 250 ms free-action window in 120 seconds after first bind", () => {
    const engine = createSimulationEngine(testConfig({
      rootSeed: "extinguisher-bind-uptime-v1",
      entities: [hero("hero-1", 2, 2), enemy("extinguisher-1", 4, 2, "extinguisher")],
      initialIntentByEnemyId: {},
    }));
    expect(engine.snapshot().activeIntents[0]?.templateKey).toBe("bind");

    let firstBindTick: number | null = null;
    let observationEndsAt = Number.POSITIVE_INFINITY;
    let immobilized = false;
    let consecutiveFreeTicks = 0;
    let longestFreeWindow = 0;
    let applicationCount = 0;

    while (engine.snapshot().serverTick < observationEndsAt) {
      const result = engine.advanceOneTick();
      for (const event of result.events) {
        if ((event.eventType === "status.applied" || event.eventType === "status.refreshed") &&
          event.payload.entityId === "hero-1" && event.payload.statusKey === "immobilized") {
          immobilized = true;
          applicationCount += 1;
          if (firstBindTick === null) {
            firstBindTick = event.serverTick;
            observationEndsAt = firstBindTick + 2_400;
          }
        } else if (event.eventType === "status.expired" && event.payload.entityId === "hero-1" &&
          event.payload.statusKey === "immobilized") {
          immobilized = false;
        }
      }

      if (firstBindTick !== null) {
        if (immobilized) {
          consecutiveFreeTicks = 0;
        } else {
          consecutiveFreeTicks += 1;
          longestFreeWindow = Math.max(longestFreeWindow, consecutiveFreeTicks);
        }
      }
    }

    expect(applicationCount).toBeGreaterThan(1);
    expect(longestFreeWindow).toBeGreaterThanOrEqual(5);
  });
});
