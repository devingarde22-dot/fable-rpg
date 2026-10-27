import { describe, expect, it } from "vitest";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { replayEvents } from "../src/replay/replay.js";
import { stateHash, stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { hero, testConfig } from "./createTestEngine.js";

describe("stamina regeneration replay", () => {
  it("replays stamina events and tick journal to the same snapshot and hash", () => {
    const config = testConfig({
      entities: [
        hero("hero-b", 1, 1, "movement", false, 5),
        hero("hero-a", 6, 6, "movement", false, 5),
      ],
      heroIdByActorId: { "actor-a": "hero-a", "actor-b": "hero-b" },
    });
    const initialState = createRuntimeState(config);
    const engine = createSimulationEngine(config);
    engine.advanceTicks(600);

    const live = engine.snapshot();
    const eventReplay = replayEvents(initialState, engine.events());
    const journalReplay = engine.replayJournal();
    expect(eventReplay).toEqual(live);
    expect(journalReplay).toEqual(live);
    expect(stateHashFromSnapshot(eventReplay)).toBe(stateHash(engine.state as ReturnType<typeof createRuntimeState>));
    expect(stateHashFromSnapshot(journalReplay)).toBe(stateHash(engine.state as ReturnType<typeof createRuntimeState>));
  });

  it("includes the next regeneration tick in the canonical state hash", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false, 5)],
      heroIdByActorId: { "actor-1": "hero-1" },
    }));
    const snapshot = engine.snapshot();
    const changedTimerSnapshot = structuredClone(snapshot);
    const changedHero = changedTimerSnapshot.entities.find((entity) => entity.id === "hero-1");
    if (!changedHero || changedHero.kind !== "hero") throw new Error("expected hero snapshot");
    changedHero.stamina.nextRegenAtTick = 301;

    expect(stateHashFromSnapshot(changedTimerSnapshot)).not.toBe(stateHashFromSnapshot(snapshot));
  });

  it("rejects a stamina event that does not match the due +1 transition", () => {
    const config = testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false, 5)],
      heroIdByActorId: { "actor-1": "hero-1" },
    });
    const engine = createSimulationEngine(config);
    engine.advanceTicks(300);
    const validEvent = engine.events().find((event) => event.eventType === "stamina.changed");
    if (!validEvent || validEvent.eventType !== "stamina.changed") throw new Error("expected stamina.changed event");
    const invalidEvent = structuredClone(validEvent);
    invalidEvent.payload.current += 1;

    expect(() => replayEvents(createRuntimeState(config), [invalidEvent])).toThrow(/due regeneration transition/);
  });
});
