import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { hero, enemy, moveCommand, testConfig } from "./createTestEngine.js";
import type { EntityRuntime } from "../src/engine/types.js";

describe("stamina regeneration integration", () => {
  it("regenerates one stamina exactly every 300 ticks and stops at max", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false, 5)],
      heroIdByActorId: { "actor-1": "hero-1" },
    }));

    engine.advanceTicks(299);
    expect(engine.events().filter((event) => event.eventType === "stamina.changed")).toHaveLength(0);
    expect(staminaOf(engine.snapshot().entities, "hero-1")).toMatchObject({ current: 3, max: 5, nextRegenAtTick: 300 });

    const firstDue = engine.advanceOneTick();
    expect(firstDue.events).toMatchObject([{
      eventType: "stamina.changed",
      serverTick: 300,
      payload: { heroId: "hero-1", current: 4, maximum: 5, reason: "regeneration" },
    }]);
    expect(staminaOf(engine.snapshot().entities, "hero-1")).toMatchObject({ current: 4, max: 5, nextRegenAtTick: 600 });

    engine.advanceTicks(300);
    expect(staminaOf(engine.snapshot().entities, "hero-1")).toMatchObject({ current: 5, max: 5, nextRegenAtTick: null });
    expect(engine.events().filter((event) => event.eventType === "stamina.changed")).toHaveLength(2);
    engine.advanceTicks(600);
    expect(engine.events().filter((event) => event.eventType === "stamina.changed")).toHaveLength(2);
  });

  it("emits heroes in stable ID order without mode-specific regeneration blocks", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-z", 1, 1, "movement", false, 4),
        hero("hero-a", 4, 4, "melee", false, 4),
        hero("hero-ranged", 7, 7, "ranged", true, 4),
      ],
      heroIdByActorId: { "actor-a": "hero-a", "actor-ranged": "hero-ranged", "actor-z": "hero-z" },
    }));

    engine.advanceTicks(300);
    const events = engine.events().filter((event) => event.eventType === "stamina.changed");
    expect(events.map((event) => event.eventType === "stamina.changed" ? event.payload.heroId : "")).toEqual(["hero-a", "hero-ranged", "hero-z"]);
    expect(events.every((event) => event.sceneRevision === 1)).toBe(true);
  });

  it("runs resource resolution after player commands in the same tick batch", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false, 5)],
      heroIdByActorId: { "actor-1": "hero-1" },
    }));
    engine.advanceTicks(295);
    expect(engine.submit(moveCommand("move-at-regeneration-tick", "right", { revision: 0 }))).toMatchObject({ status: "queued" });
    const dueTick = engine.advanceTicks(5).at(-1);
    expect(dueTick?.serverTick).toBe(300);
    expect(dueTick?.events.map((event) => event.eventType)).toEqual(["scene.entity_moved", "stamina.changed"]);
    expect(dueTick?.events.map((event) => event.eventIndex)).toEqual([0, 1]);
  });

  it("does not regenerate heroes whose aliveState is not active", () => {
    const inactiveHero = hero("hero-inactive", 1, 1, "movement", false, 5) as Extract<EntityRuntime, { kind: "hero" }>;
    inactiveHero.hp.current = 0;
    inactiveHero.aliveState = "critically_injured";
    const engine = createSimulationEngine(testConfig({
      entities: [inactiveHero],
      heroIdByActorId: {},
    }));

    engine.advanceTicks(600);
    expect(staminaOf(engine.snapshot().entities, "hero-inactive")).toMatchObject({ current: 3, max: 5, nextRegenAtTick: null });
    expect(engine.events().some((event) => event.eventType === "stamina.changed")).toBe(false);
  });

  it("stops regeneration when HP damage makes a hero critically injured", () => {
    const oneHpHero = hero("hero-1", 3, 3, "melee", false, 5) as Extract<EntityRuntime, { kind: "hero" }>;
    oneHpHero.hp.current = 1;
    const engine = createSimulationEngine(testConfig({
      entities: [oneHpHero, enemy("enemy-1", 4, 3)],
      heroIdByActorId: { "actor-1": "hero-1" },
      initialIntentByEnemyId: { "enemy-1": "melee_strike" },
    }));

    engine.advanceTicks(120);
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")).toMatchObject({
      aliveState: "critically_injured",
      hp: { current: 0 },
      stamina: { current: 3, max: 5, nextRegenAtTick: null },
    });
    engine.advanceTicks(300);
    expect(engine.events().some((event) => event.eventType === "stamina.changed")).toBe(false);
  });
});

function staminaOf(entities: readonly EntityRuntime[], id: string) {
  const entity = entities.find((candidate) => candidate.id === id);
  if (!entity || entity.kind !== "hero") throw new Error(`Missing hero ${id}`);
  return entity.stamina;
}
