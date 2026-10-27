import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type { StatusLayer } from "../src/engine/types.js";
import { enemy, hero, moveCommand, testConfig } from "./createTestEngine.js";

function bindEngine(enemyTemplateKey = "test_binding_enemy") {
  return createSimulationEngine(testConfig({
    entities: [hero("hero-status", 1, 1), enemy("enemy-bind", 7, 1, enemyTemplateKey)],
    heroIdByActorId: { "actor-status": "hero-status" },
    initialIntentByEnemyId: {
      "enemy-bind": enemyTemplateKey === "test_refreshing_bind_enemy" ? "test_bind_refresh" : "test_bind_once",
    },
  }));
}

const heroState = (engine: ReturnType<typeof createSimulationEngine>) =>
  engine.snapshot().entities.find((entity) => entity.id === "hero-status");

describe("immobilized status integration", () => {
  it("applies bind, rejects movement without mutation, expires at 300 ticks, then allows movement", () => {
    const engine = bindEngine();
    const bindTick = engine.advanceTicks(300).at(-1);
    const bindEvents = bindTick?.events ?? [];
    expect(bindEvents.map((event) => event.eventType)).toContain("status.applied");
    expect(bindEvents.findIndex((event) => event.eventType === "intent.resolved"))
      .toBeLessThan(bindEvents.findIndex((event) => event.eventType === "status.applied"));
    expect(heroState(engine)).toMatchObject({
      id: "hero-status",
      statuses: [{ templateKey: "immobilized", appliedAtTick: 300, expiresAtTick: 600, refreshPolicy: "refresh_duration" }],
    });

    const blockedRevision = engine.snapshot().sceneRevision;
    expect(engine.submit(moveCommand("blocked-before-expiry", "right", {
      actorId: "actor-status", revision: blockedRevision,
    })).status).toBe("queued");
    const blocked = engine.advanceTicks(5).at(-1);
    expect(blocked?.commandResults).toMatchObject([{ requestId: "blocked-before-expiry", status: "rejected", code: "ENTITY_UNABLE_TO_ACT" }]);
    expect(blocked?.events).toEqual([]);
    expect(engine.snapshot().sceneRevision).toBe(blockedRevision);
    expect(blocked?.events.some((event) => event.eventType === "scene.entity_moved")).toBe(false);
    expect(heroState(engine)).toMatchObject({ position: { x: 1, y: 1 } });

    engine.advanceTicks(290); // from tick 305 to 595; queue movement into the window that closes at expiry tick 600
    const dueRevision = engine.snapshot().sceneRevision;
    engine.submit(moveCommand("blocked-on-expiry-tick", "right", {
      actorId: "actor-status", revision: dueRevision,
    }));
    const due = engine.advanceTicks(5).at(-1);
    expect(due?.serverTick).toBe(600);
    expect(due?.commandResults).toMatchObject([{ requestId: "blocked-on-expiry-tick", status: "rejected", code: "ENTITY_UNABLE_TO_ACT" }]);
    expect(due?.events.some((event) => event.causedByRequestId === "blocked-on-expiry-tick")).toBe(false);
    expect(due?.events.map((event) => event.eventType)).toContain("status.expired");
    expect(heroState(engine)?.statuses).toEqual([]);

    const nextRevision = engine.snapshot().sceneRevision;
    engine.submit(moveCommand("move-after-expiry", "right", {
      actorId: "actor-status", revision: nextRevision,
    }));
    const resumed = engine.advanceTicks(5).at(-1);
    expect(resumed?.commandResults).toMatchObject([{ requestId: "move-after-expiry", status: "accepted" }]);
    expect(heroState(engine)).toMatchObject({ position: { x: 2, y: 1 }, statuses: [] });
  });

  it("refreshes the same status layer to a new full 300-tick deadline instead of expiring it", () => {
    const engine = bindEngine("test_refreshing_bind_enemy");
    engine.advanceTicks(300);
    const firstLayer = heroState(engine)?.statuses[0];
    expect(firstLayer).toMatchObject({ appliedAtTick: 300, expiresAtTick: 600, stacks: 1 });

    const refreshTick = engine.advanceTicks(300).at(-1);
    expect(refreshTick?.serverTick).toBe(600);
    expect(refreshTick?.events.map((event) => event.eventType)).toContain("status.refreshed");
    expect(refreshTick?.events.some((event) => event.eventType === "status.expired")).toBe(false);
    const refreshedLayer = heroState(engine)?.statuses[0];
    expect(refreshedLayer).toMatchObject({
      id: firstLayer?.id,
      templateKey: "immobilized",
      appliedAtTick: 600,
      expiresAtTick: 900,
      stacks: 1,
      refreshPolicy: "refresh_duration",
    });
    expect(heroState(engine)?.statuses).toHaveLength(1);
  });

  it("keeps a refreshed layer effective through tick 900, expires it there, then resumes movement", () => {
    const refreshedLayer: StatusLayer = {
      id: "status:hero-status:immobilized:enemy-bind:refresh",
      templateKey: "immobilized",
      sourceEntityId: "enemy-bind",
      potency: 1,
      stacks: 1,
      appliedAtTick: 600,
      expiresAtTick: 900,
      refreshPolicy: "refresh_duration",
    };
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-status", 1, 1, "movement", false, 3, { statuses: [refreshedLayer] }),
        enemy("enemy-bind", 7, 1),
      ],
      heroIdByActorId: { "actor-status": "hero-status" },
      initialServerTick: 600,
    }));

    engine.advanceTicks(295);
    engine.submit(moveCommand("refreshed-lock-due", "right", {
      actorId: "actor-status", revision: engine.snapshot().sceneRevision,
    }));
    const due = engine.advanceTicks(5).at(-1);
    expect(due?.serverTick).toBe(900);
    expect(due?.commandResults).toMatchObject([{ requestId: "refreshed-lock-due", status: "rejected", code: "ENTITY_UNABLE_TO_ACT" }]);
    expect(due?.events.map((event) => event.eventType)).toContain("status.expired");
    expect(heroState(engine)?.statuses).toEqual([]);

    engine.submit(moveCommand("move-after-refreshed-expiry", "right", {
      actorId: "actor-status", revision: engine.snapshot().sceneRevision,
    }));
    const resumed = engine.advanceTicks(5).at(-1);
    expect(resumed?.commandResults).toMatchObject([{ requestId: "move-after-refreshed-expiry", status: "accepted" }]);
    expect(heroState(engine)).toMatchObject({ position: { x: 2, y: 1 }, statuses: [] });
  });
});
