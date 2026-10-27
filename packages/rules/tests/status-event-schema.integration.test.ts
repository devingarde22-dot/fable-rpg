import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/event.schema.json", import.meta.url), "utf8")) as object;
const validateEvent = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function createStatusEngine(enemyTemplateKey: string) {
  return createSimulationEngine(testConfig({
    entities: [hero("hero-status", 1, 1), enemy("enemy-bind", 7, 1, enemyTemplateKey)],
    heroIdByActorId: { "actor-status": "hero-status" },
    initialIntentByEnemyId: {
      "enemy-bind": enemyTemplateKey === "test_refreshing_bind_enemy" ? "test_bind_refresh" : "test_bind_once",
    },
  }));
}

describe("status event JSON Schema", () => {
  it("validates applied and expired immobilized events", () => {
    const engine = createStatusEngine("test_binding_enemy");
    engine.advanceTicks(600);
    const statusEvents = engine.events().filter((event) => event.eventType.startsWith("status."));
    expect(statusEvents.map((event) => event.eventType)).toEqual(["status.applied", "status.expired"]);
    for (const event of statusEvents) expect(validateEvent(event), JSON.stringify(validateEvent.errors)).toBe(true);
  });

  it("validates refreshed event and rejects a duration that differs from the fixed status duration", () => {
    const engine = createStatusEngine("test_refreshing_bind_enemy");
    engine.advanceTicks(600);
    const refreshed = engine.events().find((event) => event.eventType === "status.refreshed");
    if (!refreshed || refreshed.eventType !== "status.refreshed") throw new Error("expected status.refreshed");
    expect(validateEvent(refreshed), JSON.stringify(validateEvent.errors)).toBe(true);

    const invalid = structuredClone(refreshed);
    invalid.payload.timer.durationMs = 14_950;
    expect(validateEvent(invalid)).toBe(false);

    const unsupportedStatus = structuredClone(refreshed);
    unsupportedStatus.payload.statusKey = "unconscious" as "immobilized";
    expect(validateEvent(unsupportedStatus)).toBe(false);
  });
});
