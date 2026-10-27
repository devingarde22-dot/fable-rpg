import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { cellIndex } from "../src/grid/Grid.js";
import { enemy, gameplayState, hero, modeCommand, moveCommand, testConfig } from "./createTestEngine.js";

describe("player.move integration", () => {
  it.each([
    ["up", { x: 1, y: 0 }],
    ["down", { x: 1, y: 2 }],
    ["left", { x: 0, y: 1 }],
    ["right", { x: 2, y: 1 }],
  ] as const)("moves one orthogonal cell %s and emits a canonical event", (direction, destination) => {
    const engine = createSimulationEngine(testConfig());
    expect(engine.submit(moveCommand(`move-${direction}`, direction))).toMatchObject({ status: "queued", windowId: 0 });
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")?.position).toEqual({ x: 1, y: 1 });
    const ticks = engine.advanceTicks(5);
    const result = ticks.at(-1);
    expect(result?.closedWindowId).toBe(0);
    expect(result?.sceneRevision).toBe(1);
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")?.position).toEqual(destination);
    expect(engine.events()).toHaveLength(1);
    expect(engine.events()[0]).toMatchObject({
      protocolVersion: "fable.protocol.v1",
      schemaVersion: 1,
      eventType: "scene.entity_moved",
      eventVersion: 1,
      sceneRevision: 1,
      serverTick: 5,
      eventIndex: 0,
      causedByRequestId: `move-${direction}`,
      actorId: "actor-1",
      payload: { entityId: "hero-1", from: { x: 1, y: 1 }, to: destination },
    });
  });

  it.each([
    { direction: "up" as const, from: [1, 0] as const, expected: "CELL_OUT_OF_BOUNDS" },
    { direction: "right" as const, from: [7, 2] as const, expected: "CELL_BLOCKED" },
    { direction: "down" as const, from: [3, 2] as const, expected: "CELL_BLOCKED" },
  ])("rejects bounds and terrain collision without gameplay mutation", ({ direction, from, expected }) => {
    const terrain = expected === "CELL_BLOCKED"
      ? [{ cell: { x: from[0] + (direction === "right" ? 1 : 0), y: from[1] + (direction === "down" ? 1 : 0) }, terrain: direction === "right" ? "wall" as const : "statue" as const }]
      : [];
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", from[0], from[1])],
      terrain,
    }));
    const submit = engine.submit(moveCommand("blocked", direction));
    expect(submit.status).toBe("queued");
    const before = engine.snapshot();
    const closingResults = engine.advanceTicks(5);
    const after = engine.snapshot();
    expect(gameplayState(after)).toEqual(gameplayState(before));
    expect(after.serverTick).toBe(before.serverTick + 5);
    expect(after.scene.inputWindow.windowId).toBe(before.scene.inputWindow.windowId + 1);
    expect(closingResults.at(-1)?.commandResults[0]).toMatchObject({ status: "rejected", code: expected });
    expect(engine.events()).toHaveLength(0);
  });

  it("blocks movement through enemy, ally, wall and statue occupied/terrain cells", () => {
    for (const { blocker, terrain, target } of [
      { blocker: hero("hero-2", 2, 1), terrain: [] as const, target: "ally" },
      { blocker: undefined, terrain: [{ cell: { x: 2, y: 1 }, terrain: "wall" as const }], target: "wall" },
      { blocker: undefined, terrain: [{ cell: { x: 2, y: 1 }, terrain: "statue" as const }], target: "statue" },
    ]) {
      const entities = blocker ? [hero("hero-1", 1, 1), blocker] : [hero("hero-1", 1, 1)];
      const engine = createSimulationEngine(testConfig({ entities, terrain }));
      engine.submit(moveCommand(`move-${target}`, "right"));
      const result = engine.advanceTicks(5).at(-1);
      expect(result?.commandResults[0]?.status).toBe("rejected");
      expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")?.position).toEqual({ x: 1, y: 1 });
      expect(engine.snapshot().sceneRevision).toBe(0);
      expect(engine.events()).toHaveLength(0);
    }
  });

  it("rejects movement into an enemy-occupied cell while retreat contact immunity is active", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "melee"), enemy("enemy-1", 2, 1)],
    }));
    engine.submit(modeCommand("player.enter_movement_mode", "retreat"));
    const retreat = engine.advanceTicks(5).at(-1);
    expect(retreat?.commandResults[0]?.status).toBe("accepted");
    expect(engine.snapshot().scene.contactImmunityUntilTick.get("hero-1")).toBe(305);

    engine.submit(moveCommand("blocked-by-enemy", "right", { revision: 1 }));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.commandResults[0]).toMatchObject({ status: "rejected", code: "CELL_OCCUPIED" });
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")?.position).toEqual({ x: 1, y: 1 });
    expect(engine.snapshot().sceneRevision).toBe(1);
  });

  it("rejects stale revision, unauthorized actor, invalid mode, and duplicate request", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), hero("hero-2", 4, 4, null)],
      heroIdByActorId: { "actor-1": "hero-1", "actor-2": "hero-2" },
    }));
    const beforeStale = engine.snapshot();
    expect(engine.submit(moveCommand("stale", "right", { revision: 99 }))).toMatchObject({ status: "rejected", code: "STALE_SCENE_REVISION" });
    expect(gameplayState(engine.snapshot())).toEqual(gameplayState(beforeStale));
    expect(engine.events()).toHaveLength(0);
    expect(engine.submit(moveCommand("unauth", "right", { actorId: "unknown" }))).toMatchObject({ status: "rejected", code: "AUTH_FORBIDDEN" });
    expect(engine.submit(moveCommand("mode", "right", { actorId: "actor-2" }))).toMatchObject({ status: "rejected", code: "INVALID_MODE" });
    const accepted = engine.submit(moveCommand("same", "right"));
    expect(accepted.status).toBe("queued");
    expect(engine.submit(moveCommand("same", "right"))).toMatchObject({ status: "duplicate", requestId: "same" });
    engine.advanceTicks(5);
    expect(engine.events()).toHaveLength(1);
    expect(engine.snapshot().sceneRevision).toBe(1);
  });

  it("resolves three simultaneous players reserving one target cell deterministically", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-a", 1, 2), hero("hero-b", 3, 2), hero("hero-c", 2, 1)],
      heroIdByActorId: { "actor-1": "hero-a", "actor-b": "hero-b", "actor-c": "hero-c" },
    }));
    // All three requests enter the same 250 ms window and target (2, 2).
    engine.submit(moveCommand("request-a", "right", { sequence: 10 }));
    engine.submit(moveCommand("request-b", "left", { actorId: "actor-b", sequence: 2 }));
    engine.submit(moveCommand("request-c", "down", { actorId: "actor-c", sequence: 5 }));
    const results = engine.advanceTicks(5).at(-1);
    expect(results?.commandResults.map((entry) => entry.requestId)).toEqual(["request-b", "request-c", "request-a"]);
    expect(results?.commandResults.map((entry) => entry.status)).toEqual(["accepted", "rejected", "rejected"]);
    expect(results?.commandResults.slice(1)).toEqual([
      expect.objectContaining({ code: "CONFLICTING_BATCH_STATE" }),
      expect.objectContaining({ code: "CONFLICTING_BATCH_STATE" }),
    ]);
    expect(engine.snapshot().sceneRevision).toBe(1);
    expect(engine.events()).toHaveLength(1);
    expect(engine.events()[0]?.causedByRequestId).toBe("request-b");
    expect(engine.snapshot().scene.cells[cellIndex({ x: 2, y: 2 })]?.occupantId).toBe("hero-b");
  });
});
