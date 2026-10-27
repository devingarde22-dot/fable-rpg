import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type { StatusLayer } from "../src/engine/types.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/event.schema.json", import.meta.url), "utf8")) as object;
const validateEvent = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function createStatusEngine(enemyTemplateKey: string) {
  const isGuard = enemyTemplateKey === "test_refreshing_guard_enemy";
  return createSimulationEngine(testConfig({
    entities: isGuard
      ? [hero("hero-status", 1, 1), enemy("enemy-bind", 4, 4, enemyTemplateKey), enemy("enemy-ally", 5, 4, "slag_shooter")]
      : [hero("hero-status", 1, 1), enemy("enemy-bind", 7, 1, enemyTemplateKey)],
    heroIdByActorId: { "actor-status": "hero-status" },
    initialIntentByEnemyId: {
      "enemy-bind": enemyTemplateKey === "test_refreshing_guard_enemy"
        ? "test_ally_guard_refresh"
        : enemyTemplateKey === "test_refreshing_bind_enemy"
          ? "test_bind_refresh"
          : "test_bind_once",
    },
  }));
}

function createProductionExtinguisherEngine() {
  return createSimulationEngine(testConfig({
    entities: [
      hero("hero-guard", 1, 1),
      enemy("enemy-extinguisher", 4, 4, "extinguisher"),
      enemy("enemy-ally", 5, 4, "slag_shooter"),
    ],
    heroIdByActorId: { "actor-1": "hero-guard" },
    initialIntentByEnemyId: { "enemy-extinguisher": "ally_guard" },
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

  it("validates refreshed immobilized and rejects invalid duration and unsupported key", () => {
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

  it("validates production Ally Guard events and rejects missing/invalid potency or timer", () => {
    const appliedEngine = createProductionExtinguisherEngine();
    appliedEngine.advanceTicks(300);
    const applied = appliedEngine.events().find((event) => event.eventType === "status.applied" && event.payload.statusKey === "ally_guard");
    if (!applied || applied.eventType !== "status.applied") throw new Error("expected Ally Guard status.applied");
    expect(validateEvent(applied), JSON.stringify(validateEvent.errors)).toBe(true);

    const invalidPotency = structuredClone(applied);
    invalidPotency.payload.publicPotency = 21;
    expect(validateEvent(invalidPotency)).toBe(false);
    const missingAppliedPotency = structuredClone(applied) as unknown as { payload: { publicPotency?: number } };
    delete missingAppliedPotency.payload.publicPotency;
    expect(validateEvent(missingAppliedPotency)).toBe(false);
    const invalidDuration = structuredClone(applied);
    invalidDuration.payload.timer.durationMs = 14_950;
    expect(validateEvent(invalidDuration)).toBe(false);

    const refreshEngine = createStatusEngine("test_refreshing_guard_enemy");
    refreshEngine.advanceTicks(600);
    const refreshed = refreshEngine.events().find((event) => event.eventType === "status.refreshed" && event.payload.statusKey === "ally_guard");
    if (!refreshed || refreshed.eventType !== "status.refreshed") throw new Error("expected Ally Guard status.refreshed");
    expect(validateEvent(refreshed), JSON.stringify(validateEvent.errors)).toBe(true);
    const missingRefreshedPotency = structuredClone(refreshed) as unknown as { payload: { publicPotency?: number } };
    delete missingRefreshedPotency.payload.publicPotency;
    expect(validateEvent(missingRefreshedPotency)).toBe(false);

    const layer: StatusLayer = {
      id: "status:enemy-ally:ally_guard:enemy-extinguisher:expiry-schema",
      templateKey: "ally_guard",
      sourceEntityId: "enemy-extinguisher",
      potency: 20,
      stacks: 1,
      appliedAtTick: 0,
      expiresAtTick: 5,
      refreshPolicy: "refresh_duration",
    };
    const expiryEngine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-guard", 1, 1),
        enemy("enemy-extinguisher", 4, 4, "extinguisher"),
        { ...enemy("enemy-ally", 5, 4, "slag_shooter"), statuses: [layer] },
      ],
      heroIdByActorId: { "actor-1": "hero-guard" },
      initialIntentByEnemyId: {},
    }));
    expiryEngine.advanceTicks(5);
    const expired = expiryEngine.events().find((event) => event.eventType === "status.expired" && event.payload.statusKey === "ally_guard");
    if (!expired || expired.eventType !== "status.expired") throw new Error("expected Ally Guard status.expired");
    expect(validateEvent(expired), JSON.stringify(validateEvent.errors)).toBe(true);
  });
});
