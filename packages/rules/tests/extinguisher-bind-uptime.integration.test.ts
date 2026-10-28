import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { stateHash } from "../src/replay/stateHash.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

const SEED = "extinguisher-bind-uptime-v2";
const TICKS_PER_SECOND = 20;
const BIND_INTERVAL_TICKS = 12 * TICKS_PER_SECOND;
const STATUS_DURATION_TICKS = 15 * TICKS_PER_SECOND;
const OBSERVATION_TICKS = 120 * TICKS_PER_SECOND;
const FAIRNESS_WINDOW_TICKS = 10 * TICKS_PER_SECOND;
const FAIRNESS_PERIOD_TICKS = 30 * TICKS_PER_SECOND;

function createEngine() {
  return createSimulationEngine(testConfig({
    rootSeed: SEED,
    entities: [hero("hero-1", 2, 2), enemy("extinguisher-1", 4, 2, "extinguisher")],
    initialIntentByEnemyId: {},
  }));
}

function advance(engine: ReturnType<typeof createEngine>, ticks: number) {
  const events = [];
  for (let i = 0; i < ticks; i += 1) events.push(...engine.advanceOneTick().events);
  return events;
}

describe("Extinguisher bind uptime", () => {
  it("meets a 10-second continuous free window in every 30-second interval over 120 seconds", () => {
    const engine = createEngine();
    expect(engine.snapshot().activeIntents[0]?.templateKey).toBe("bind");

    let firstBindTick: number | null = null;
    const immobilizedTicks = new Set<number>();
    const applications: number[] = [];
    const selectedIntents: Array<{ tick: number; key: string }> = [];
    while (firstBindTick === null || engine.snapshot().serverTick < firstBindTick + OBSERVATION_TICKS) {
      const result = engine.advanceOneTick();
      for (const event of result.events) {
        if ((event.eventType === "status.applied" || event.eventType === "status.refreshed") &&
          event.payload.entityId === "hero-1" && event.payload.statusKey === "immobilized") {
          firstBindTick ??= event.serverTick;
          applications.push(event.serverTick);
        }
        if (event.eventType === "intent.started" && event.payload.enemyId === "extinguisher-1") {
          selectedIntents.push({ tick: event.serverTick, key: event.payload.templateKey });
        }
      }
      if (firstBindTick !== null && engine.snapshot().entities.find((entity) => entity.id === "hero-1")?.statuses
        .some((status) => status.templateKey === "immobilized")) {
        immobilizedTicks.add(engine.snapshot().serverTick);
      }
    }

    const observedStart = firstBindTick!;
    const freeRuns = Array.from({ length: 4 }, (_, interval) => {
      const start = observedStart + interval * FAIRNESS_PERIOD_TICKS + 1;
      const end = start + FAIRNESS_PERIOD_TICKS;
      let run = 0;
      let longest = 0;
      for (let tick = start; tick < end; tick += 1) {
        run = immobilizedTicks.has(tick) ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      return longest;
    });

    expect(applications.length).toBeGreaterThan(1);
    expect(applications.slice(1).every((tick, index) => tick - applications[index]! >= BIND_INTERVAL_TICKS)).toBe(true);
    expect(freeRuns.every((ticks) => ticks >= FAIRNESS_WINDOW_TICKS)).toBe(true);
    expect(selectedIntents.some(({ key }) => key === "move_close")).toBe(true);

    const replay = createEngine();
    const replayEvents = advance(replay, engine.snapshot().serverTick);
    expect(stateHash(replay.state)).toBe(stateHash(engine.state));
    const replayApplications: number[] = [];
    for (const event of replayEvents) {
      if ((event.eventType === "status.applied" || event.eventType === "status.refreshed") &&
        event.payload.entityId === "hero-1" && event.payload.statusKey === "immobilized") {
        replayApplications.push(event.serverTick);
      }
    }
    expect(replayApplications).toEqual(applications);
  });

  it("does not reselect the hero on the expiry boundary tick, then targets them after valid resolution", () => {
    const engine = createEngine();
    const firstBindEvents = advance(engine, BIND_INTERVAL_TICKS);
    let appliedTick: number | null = null;
    for (const event of firstBindEvents) {
      if (event.eventType === "status.applied" && event.payload.entityId === "hero-1") appliedTick = event.serverTick;
    }
    expect(appliedTick).not.toBeNull();
    const expiresAt = appliedTick! + STATUS_DURATION_TICKS;
    advance(engine, expiresAt - engine.snapshot().serverTick - 1);

    const boundary = engine.advanceOneTick();
    const boundaryStartKeys: string[] = [];
    let expired = false;
    for (const event of boundary.events) {
      if (event.eventType === "intent.started" && event.payload.enemyId === "extinguisher-1") boundaryStartKeys.push(event.payload.templateKey);
      if (event.eventType === "status.expired" && event.payload.entityId === "hero-1") expired = true;
    }
    expect(expired).toBe(true);
    expect(boundaryStartKeys).not.toContain("bind");
    expect(boundaryStartKeys).toContain("hold_position");

    const nextSelectionAt = expiresAt + 15 * TICKS_PER_SECOND;
    advance(engine, nextSelectionAt - engine.snapshot().serverTick - 1);
    const selectedEvents = engine.advanceOneTick().events;
    let selectedHero = false;
    for (const event of selectedEvents) {
      if (event.eventType === "intent.target_selected" && event.payload.enemyId === "extinguisher-1" && event.payload.targetEntityId === "hero-1") {
        selectedHero = true;
      }
    }
    expect(selectedHero).toBe(true);
  });
});
