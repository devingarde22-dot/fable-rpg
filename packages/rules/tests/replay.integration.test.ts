import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { replayEvents } from "../src/replay/replay.js";
import { stateHash, stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { testConfig, moveCommand } from "./createTestEngine.js";

describe("deterministic replay", () => {
  it("replays movement events to the same final snapshot and state hash", () => {
    const config = testConfig();
    const initial = createRuntimeState(config);
    const engine = createSimulationEngine(config);
    engine.submit(moveCommand("move-1", "right", { sequence: 1 }));
    engine.submit(moveCommand("move-2", "down", { sequence: 2, revision: 0 }));
    engine.advanceTicks(5);
    const live = engine.snapshot();
    const replayed = replayEvents(initial, engine.events());
    expect(replayed).toEqual(live);
    expect(stateHashFromSnapshot(replayed)).toBe(stateHash(engine.state as ReturnType<typeof createRuntimeState>));
    expect(engine.replay(engine.events())).toEqual(live);
    expect(engine.replayJournal()).toEqual(live);
  });

  it("rejects reordered, out-of-scope and inconsistent replay events", () => {
    const config = testConfig();
    const engine = createSimulationEngine(config);
    engine.submit(moveCommand("move-1", "right"));
    engine.advanceTicks(5);
    const event = engine.events().find((candidate) => candidate.eventType === "scene.entity_moved");
    if (!event || event.eventType !== "scene.entity_moved") throw new Error("expected movement event");
    const initial = createRuntimeState(config);
    expect(() => replayEvents(initial, [{ ...event, serverSequence: 0 }])).toThrow(/consecutive/);
    expect(() => replayEvents(initial, [{ ...event, sceneId: "other" }])).toThrow(/scope/);
    expect(() => replayEvents(initial, [{ ...event, payload: { ...event.payload, from: { x: 8, y: 8 } } }])).toThrow(/from-cell/);
  });

  it("keeps deterministic replay stable across 120 ticks and 24 committed movement batches", () => {
    const config = testConfig();
    const run = () => {
      const engine = createSimulationEngine(config);
      for (let batch = 0; batch < 24; batch += 1) {
        const direction = batch % 2 === 0 ? "right" : "left";
        const revision = engine.snapshot().sceneRevision;
        expect(engine.submit(moveCommand(`long-run-${batch}`, direction, {
          revision,
          sequence: batch + 1,
        }))).toMatchObject({ status: "queued" });
        const closingTick = engine.advanceTicks(5).at(-1);
        expect(closingTick?.commandResults).toMatchObject([
          { requestId: `long-run-${batch}`, status: "accepted" },
        ]);
      }
      return engine;
    };

    const first = run();
    const second = run();
    const live = first.snapshot();
    const replayed = first.replay(first.events());
    expect(live.serverTick).toBe(120);
    expect(live.sceneRevision).toBe(24);
    expect(first.events()).toHaveLength(24);
    expect(first.events()).toEqual(second.events());
    expect(stateHash(first.state as ReturnType<typeof createRuntimeState>)).toBe(
      stateHash(second.state as ReturnType<typeof createRuntimeState>),
    );
    expect(replayed).toEqual(live);
    expect(stateHashFromSnapshot(replayed)).toBe(stateHash(first.state as ReturnType<typeof createRuntimeState>));
    expect(first.replayJournal()).toEqual(live);
  });

  it("replays queued input-window commands exactly before the five-tick close", () => {
    const engine = createSimulationEngine(testConfig());
    engine.submit(moveCommand("pending-window-command", "right"));
    engine.advanceTicks(2);
    const live = engine.snapshot();
    expect(live.scene.inputWindow.commands).toHaveLength(1);
    expect(engine.replayJournal()).toEqual(live);
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHash(engine.state as ReturnType<typeof createRuntimeState>));
  });
});
