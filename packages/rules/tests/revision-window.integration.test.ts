import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, moveCommand, testConfig, testIntentTemplates } from "./createTestEngine.js";

describe("scene revision across input windows", () => {
  it("does not stale-reject a command after its admission revision was current", () => {
    const shortHoldTemplates = testIntentTemplates.map((template) =>
      template.key === "hold_position" ? { ...template, durationMs: 3_050 } : template,
    );
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 7)],
      intentTemplates: shortHoldTemplates,
      initialIntentByEnemyId: { "enemy-1": "hold_position" },
    }));

    // hold_position started at tick 0 and resolves at tick 61, inside the
    // input window (ticks 61–65) in which the move below will be applied.
    engine.advanceTicks(60);
    const admittedRevision = engine.snapshot().sceneRevision;
    const queued = engine.submit(moveCommand("window-revision-move", "right", { revision: admittedRevision }));
    expect(queued).toMatchObject({ status: "queued" });

    const windowTicks = engine.advanceTicks(5);
    expect(windowTicks.some((tick) => tick.events.some((event) => event.eventType === "intent.resolved"))).toBe(true);
    const finalResult = windowTicks.at(-1)?.commandResults[0];
    const observed = finalResult?.status === "rejected" ? `rejected:${finalResult.code}` : finalResult?.status;
    expect(observed).toBe("accepted");
  });
});
