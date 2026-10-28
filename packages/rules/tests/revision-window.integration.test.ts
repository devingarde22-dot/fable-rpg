import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, modeCommand, moveCommand, testConfig, testIntentTemplates } from "./createTestEngine.js";

function noisyEngine(heroMode: "movement" | "melee" = "movement") {
  const shortHoldTemplates = testIntentTemplates.map((template) =>
    template.key === "hold_position" ? { ...template, durationMs: 3_050 } : template,
  );
  return createSimulationEngine(testConfig({
    entities: [hero("hero-1", 1, 1, heroMode), enemy("enemy-1", 7, 7)],
    intentTemplates: shortHoldTemplates,
    initialIntentByEnemyId: { "enemy-1": "hold_position" },
  }));
}

describe("scene revision across input windows", () => {
  it("applies a move after scene revision changes while preserving apply-time validation", () => {
    const engine = noisyEngine();
    // Snapshot/send at tick 60; hold_position resolves on tick 61, before application.
    engine.advanceTicks(60);
    const sentRevision = engine.snapshot().sceneRevision;
    expect(engine.submit(moveCommand("window-revision-move", "right", { revision: sentRevision }))).toMatchObject({ status: "queued" });
    const ticks = engine.advanceTicks(5);
    expect(ticks.some((tick) => tick.events.some((event) => event.eventType === "intent.resolved"))).toBe(true);
    expect(ticks.flatMap((tick) => tick.commandResults).find((result) => result.requestId === "window-revision-move"))
      .toMatchObject({ status: "accepted" });
  });

  it("accepts a stale mode-command cursor at admission and applies against live mode state", () => {
    const engine = noisyEngine("melee");
    engine.advanceTicks(60);
    const sentRevision = engine.snapshot().sceneRevision;
    engine.advanceTicks(2); // noisy-scene revision changes before submit
    expect(engine.snapshot().sceneRevision).not.toBe(sentRevision);
    expect(engine.submit(modeCommand("player.enter_movement_mode", "stale-mode", { revision: sentRevision })))
      .toMatchObject({ status: "queued" });
    const result = engine.advanceTicks(3).at(-1);
    expect(result?.commandResults).toMatchObject([{ requestId: "stale-mode", status: "accepted" }]);
  });

  it("measures counterfactual legacy stale rate for player.move over uniform phases and 100–250ms delays", () => {
    const samples = 610; // 10 full 61-tick cycles; all 61 phases receive each of four delays 2–5 ticks.
    let wouldHaveRejectedUnderOldStrictGate = 0;
    let submitted = 0;
    for (let index = 0; index < samples; index += 1) {
      const engine = noisyEngine();
      const phase = index % 61;
      const delayTicks = 2 + (Math.floor(index / 61) % 4);
      engine.advanceTicks(phase);
      const clientRevision = engine.snapshot().sceneRevision;
      engine.advanceTicks(delayTicks);
      const receiveRevision = engine.snapshot().sceneRevision;
      if (clientRevision !== receiveRevision) wouldHaveRejectedUnderOldStrictGate += 1;
      const admission = engine.submit(moveCommand(`phase-delay-${index}`, "right", { revision: clientRevision }));
      expect(admission, `sample ${index}: phase=${phase}, delay=${delayTicks}`).toMatchObject({ status: "queued" });
      submitted += 1;
    }
    const percentage = (wouldHaveRejectedUnderOldStrictGate / samples) * 100;
    expect(submitted).toBe(610);
    expect(wouldHaveRejectedUnderOldStrictGate).toBe(33);
    expect(percentage).toBeGreaterThan(1);
    // This is explicitly counterfactual: C no longer emits STALE for move; all 610 real submits queued.
    expect(`${wouldHaveRejectedUnderOldStrictGate}/${samples} (${percentage.toFixed(2)}%)`)
      .toBe(`${wouldHaveRejectedUnderOldStrictGate}/610 (${(wouldHaveRejectedUnderOldStrictGate / 610 * 100).toFixed(2)}%)`);
  }, 15_000);
});
