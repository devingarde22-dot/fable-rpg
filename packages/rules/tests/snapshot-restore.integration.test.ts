import { describe, expect, it } from "vitest";
import { createSimulationEngineFromSnapshot } from "../src/engine/SimulationEngine.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { gameplayState, makeEngine, moveCommand, testConfig, testEnemyTemplates, testIntentTemplates } from "./createTestEngine.js";
import { testCardTemplates } from "./fixtures/testCards.js";

describe("snapshot restore", () => {
  it("restores authoritative state and continues deterministically", () => {
    const live = makeEngine();
    live.submit(moveCommand("restore-move-1", "right"));
    live.advanceTicks(5);
    const snapshot = live.snapshot();

    const restored = createSimulationEngineFromSnapshot(snapshot, {
      cardTemplates: testCardTemplates,
      terrain: testConfig().terrain ?? [],
      enemyTemplates: testEnemyTemplates,
      intentTemplates: testIntentTemplates,
    });

    expect(restored.snapshot()).toEqual(snapshot);
    expect(stateHashFromSnapshot(restored.snapshot())).toBe(stateHashFromSnapshot(snapshot));
    expect(gameplayState(restored.replayJournal())).toEqual(gameplayState(snapshot));

    expect(restored.advanceOneTick()).toEqual(live.advanceOneTick());
    expect(restored.snapshot()).toEqual(live.snapshot());
  });

  it("persists pause across snapshot restore, freezes time, and resumes without state drift", () => {
    const live = makeEngine();
    live.setPaused(true);
    const pausedSnapshot = live.snapshot();
    expect(pausedSnapshot.paused).toBe(true);
    expect(live.advanceTicks(20).every((tick) => tick.events.length === 0 && tick.serverTick === pausedSnapshot.serverTick)).toBe(true);

    const restored = createSimulationEngineFromSnapshot(pausedSnapshot, {
      cardTemplates: testCardTemplates,
      terrain: testConfig().terrain ?? [],
      enemyTemplates: testEnemyTemplates,
      intentTemplates: testIntentTemplates,
    });
    expect(restored.snapshot()).toEqual(pausedSnapshot);
    expect(restored.replayJournal()).toEqual(pausedSnapshot);
    expect(restored.advanceOneTick().serverTick).toBe(pausedSnapshot.serverTick);

    live.setPaused(false);
    restored.setPaused(false);
    expect(restored.advanceOneTick()).toEqual(live.advanceOneTick());
    expect(restored.snapshot()).toEqual(live.snapshot());
  });
});
