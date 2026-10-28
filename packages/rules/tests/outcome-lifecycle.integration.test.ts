import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { hero, testConfig } from "./createTestEngine.js";

describe("scene outcome lifecycle", () => {
  it("clears temporary combat state while preserving persistent hero state and replay parity", () => {
    const persistentHero = hero("hero-1", 1, 1, "ranged", false, 5, {
      hand: [{ instanceId: "hero-1-card", templateKey: "test-only-ranged-strike" }],
      revision: 4,
      nextHandRotationAtTick: 300,
      statuses: [{
        id: "status:hero-1:ally_guard:scene",
        templateKey: "ally_guard",
        sourceEntityId: "hero-1",
        potency: 20,
        stacks: 1,
        appliedAtTick: 0,
        expiresAtTick: 300,
        refreshPolicy: "refresh_duration",
      }],
    });
    if (persistentHero.kind !== "hero") throw new Error("expected hero fixture");
    persistentHero.hp.current = 777;
    persistentHero.protections = [{ id: "barrier-1", kind: "damage_barrier", sourceCardInstanceId: "hero-1-card", remainingAmount: 50 }];
    const engine = createSimulationEngine(testConfig({
      entities: [persistentHero],
      heroIdByActorId: { "actor-1": "hero-1" },
    }));
    const result = engine.confirmOutcome("success");
    const snapshot = result.snapshot;
    const finishedHero = snapshot.entities.find((entity) => entity.id === "hero-1");
    if (!finishedHero || finishedHero.kind !== "hero") throw new Error("expected finished hero");
    expect(snapshot.phase).toBe("ended");
    expect(snapshot.outcome).toBe("success");
    expect(snapshot.activeIntents).toEqual([]);
    expect(finishedHero.mode).toBeNull();
    expect(finishedHero.statuses).toEqual([]);
    expect(finishedHero.protections).toEqual([]);
    expect(finishedHero.cards.nextHandRotationAtTick).toBeNull();
    expect(finishedHero.hp.current).toBe(777);
    expect(finishedHero.stamina).toMatchObject({ current: 3, max: 5 });
    expect(finishedHero.cards.hand).toEqual([{ instanceId: "hero-1-card", templateKey: "test-only-ranged-strike" }]);
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(snapshot));
  });
});
