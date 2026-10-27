import { describe, expect, it } from "vitest";
import { applyImmobilized, hasActiveStatus, resolveDueStatusExpirations } from "../src/statuses/statusSystem.js";
import { cloneRuntimeState, createRuntimeState } from "../src/engine/createRuntimeState.js";
import type { StatusLayer } from "../src/engine/types.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

const sourceLayer: StatusLayer = {
  id: "status:hero-1:immobilized:enemy-1:initial-bind",
  templateKey: "immobilized",
  sourceEntityId: "enemy-1",
  potency: 1,
  stacks: 1,
  appliedAtTick: 10,
  expiresAtTick: 310,
  refreshPolicy: "refresh_duration",
};

function createState(statuses: StatusLayer[] = [], initialServerTick = 0) {
  return createRuntimeState(testConfig({
    entities: [hero("hero-1", 1, 1, "movement", false, 3, { statuses }), enemy("enemy-1", 2, 1)],
    heroIdByActorId: { "actor-1": "hero-1" },
    initialServerTick,
  }));
}

describe("typed status layer lifecycle", () => {
  it("deep-copies initial typed layers into runtime and cloned state", () => {
    const fixtureStatuses = [structuredClone(sourceLayer)];
    const state = createState(fixtureStatuses, 10);
    const heroRuntime = state.entities.get("hero-1");
    if (!heroRuntime || heroRuntime.kind !== "hero") throw new Error("expected hero runtime");

    heroRuntime.statuses[0]!.expiresAtTick = 400;
    const cloned = cloneRuntimeState(state);
    const clonedHero = cloned.entities.get("hero-1");
    if (!clonedHero || clonedHero.kind !== "hero") throw new Error("expected cloned hero runtime");
    clonedHero.statuses[0]!.sourceEntityId = null;

    expect(fixtureStatuses[0]?.expiresAtTick).toBe(310);
    expect(heroRuntime.statuses[0]?.sourceEntityId).toBe("enemy-1");
    expect(clonedHero.statuses[0]?.expiresAtTick).toBe(400);
  });

  it("refreshes the existing immobilized layer to a new full 300-tick duration without stacking", () => {
    const state = createState([structuredClone(sourceLayer)], 10);
    const target = state.entities.get("hero-1");
    const source = state.entities.get("enemy-1");
    if (!target || !source) throw new Error("expected status target and source");

    const pending = applyImmobilized(state, target, source, "bind-refresh-2", 25);
    const event = pending.event;
    expect(event.eventType).toBe("status.refreshed");
    expect(event.payload).toMatchObject({
      entityId: "hero-1",
      statusKey: "immobilized",
      layerId: sourceLayer.id,
      timer: { startedAtTick: 25, resolvesAtTick: 325, durationMs: 15_000, remainingMs: 15_000, paused: false },
    });
    expect(target.statuses).toEqual([{
      ...sourceLayer,
      appliedAtTick: 25,
      expiresAtTick: 325,
    }]);
    expect(hasActiveStatus(target, "immobilized", 324)).toBe(true);
    expect(hasActiveStatus(target, "immobilized", 325)).toBe(true);
    expect(hasActiveStatus(target, "immobilized", 326)).toBe(false);
  });

  it("applies a single layer with a deterministic id and exact 300-tick deadline", () => {
    const state = createState();
    const target = state.entities.get("hero-1");
    const source = state.entities.get("enemy-1");
    if (!target || !source) throw new Error("expected status target and source");

    const pending = applyImmobilized(state, target, source, "scene:enemy-1:300:test_bind_once", 300);
    expect(pending.event.eventType).toBe("status.applied");
    expect(target.statuses).toEqual([{
      id: "status:hero-1:immobilized:enemy-1:scene:enemy-1:300:test_bind_once",
      templateKey: "immobilized",
      sourceEntityId: "enemy-1",
      potency: 1,
      stacks: 1,
      appliedAtTick: 300,
      expiresAtTick: 600,
      refreshPolicy: "refresh_duration",
    }]);
    expect(hasActiveStatus(target, "immobilized", 599)).toBe(true);
  });

  it("expires due layers once in deterministic entity/layer order", () => {
    const state = createState([structuredClone(sourceLayer)], 10);
    expect(resolveDueStatusExpirations(state, 309)).toEqual([]);
    expect(resolveDueStatusExpirations(state, 310).map(({ event }) => event)).toMatchObject([
      { eventType: "status.expired", payload: { entityId: "hero-1", statusKey: "immobilized", layerId: sourceLayer.id } },
    ]);
    const heroRuntime = state.entities.get("hero-1");
    expect(heroRuntime?.statuses).toEqual([]);
    expect(resolveDueStatusExpirations(state, 310)).toEqual([]);
  });

  it("orders multiple due layers by layer id and rejects malformed initial layers", () => {
    const layerZ = { ...sourceLayer, id: "status-z" };
    const layerA = { ...sourceLayer, id: "status-a" };
    const state = createRuntimeState(testConfig({
      entities: [
        hero("hero-z", 1, 1, "movement", false, 3, { statuses: [layerZ] }),
        hero("hero-a", 2, 1, "movement", false, 3, { statuses: [layerA] }),
        enemy("enemy-1", 3, 1),
      ],
      heroIdByActorId: { "actor-1": "hero-a" },
      initialServerTick: 10,
    }));
    expect(resolveDueStatusExpirations(state, 310).map(({ event }) =>
      event.eventType === "status.expired" ? [event.payload.entityId, event.payload.layerId] : ["unexpected", "unexpected"],
    )).toEqual([["hero-a", "status-a"], ["hero-z", "status-z"]]);

    expect(() => createState([sourceLayer, structuredClone(sourceLayer)], 10)).toThrow(/invalid status layer/);
    expect(() => createState([{ ...sourceLayer, refreshPolicy: "replace" } as unknown as StatusLayer], 10))
      .toThrow(/invalid status layer/);
    expect(() => createState([{ ...sourceLayer, sourceEntityId: "missing-source" }], 10))
      .toThrow(/invalid status layer/);
  });
});
