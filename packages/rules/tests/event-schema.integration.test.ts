import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/event.schema.json", import.meta.url), "utf8")) as object;
const validateEvent = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

describe("canonical event contract", () => {
  it("validates emitted start, target selection, resolution, movement, damage, fallback, and mode events", () => {
    const moveEngine = createSimulationEngine(testConfig({
      entities: [hero("hero-move", 1, 1), enemy("enemy-move", 7, 1)],
      heroIdByActorId: { "actor-move": "hero-move" },
      initialIntentByEnemyId: { "enemy-move": "move_close" },
    }));
    moveEngine.advanceTicks(300);

    const meleeEngine = createSimulationEngine(testConfig({
      entities: [hero("hero-melee", 3, 3), enemy("enemy-melee", 4, 3)],
      heroIdByActorId: { "actor-melee": "hero-melee" },
      initialIntentByEnemyId: { "enemy-melee": "melee_strike" },
    }));
    meleeEngine.advanceTicks(120);

    const blockedEngine = createSimulationEngine(testConfig({
      terrain: [
        { cell: { x: 6, y: 7 }, terrain: "wall" },
        { cell: { x: 7, y: 6 }, terrain: "statue" },
      ],
      entities: [hero("hero-blocked", 1, 1), enemy("enemy-blocked", 7, 7)],
      heroIdByActorId: { "actor-blocked": "hero-blocked" },
      initialIntentByEnemyId: { "enemy-blocked": "move_close" },
    }));
    blockedEngine.advanceTicks(300);

    const emitted = [...moveEngine.events(), ...meleeEngine.events(), ...blockedEngine.events()];
    expect(emitted.some((event) => event.eventType === "intent.target_selected")).toBe(true);
    expect(emitted.some((event) => event.eventType === "scene.entity_moved")).toBe(true);
    expect(emitted.some((event) => event.eventType === "hp.changed")).toBe(true);
    expect(emitted.some((event) => event.eventType === "intent.cancelled")).toBe(true);
    expect(emitted.some((event) => event.eventType === "mode.changed")).toBe(true);
    for (const event of emitted) {
      expect(validateEvent(event), JSON.stringify(validateEvent.errors)).toBe(true);
    }
  });

  it("rejects timer durations that are not aligned to 50 ms", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-timer", 1, 1), enemy("enemy-timer", 7, 1)],
      heroIdByActorId: { "actor-timer": "hero-timer" },
      initialIntentByEnemyId: { "enemy-timer": "hold_position" },
    }));
    const started = engine.events().find((event) => event.eventType === "intent.started");
    if (started?.eventType !== "intent.started") throw new Error("expected intent.started event");
    const invalid = structuredClone(started);
    invalid.payload.timer.durationMs = 3_025;
    expect(validateEvent(invalid)).toBe(false);
  });

  it("validates stamina regeneration events and rejects an impossible maximum", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-stamina", 1, 1, "movement", false, 4)],
      heroIdByActorId: { "actor-stamina": "hero-stamina" },
    }));
    engine.advanceTicks(300);
    const event = engine.events().find((candidate) => candidate.eventType === "stamina.changed");
    if (!event || event.eventType !== "stamina.changed") throw new Error("expected stamina.changed event");
    expect(validateEvent(event), JSON.stringify(validateEvent.errors)).toBe(true);

    const invalid = structuredClone(event);
    invalid.payload.maximum = 2;
    expect(validateEvent(invalid)).toBe(false);
  });
});
