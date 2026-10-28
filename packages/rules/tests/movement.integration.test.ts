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

  it("rechecks legality at window close and journals an apply-time rejection as no domain event", () => {
    const engine = createSimulationEngine(testConfig({ entities: [hero("hero-1", 1, 1, null)] }));
    const before = engine.snapshot();
    const beforeEvents = engine.events();
    const requestId = "apply-time-invalid-mode";

    expect(engine.submit(moveCommand(requestId, "right"))).toMatchObject({ status: "queued" });
    expect(engine.advanceTicks(5).at(-1)?.commandResults).toMatchObject([
      { requestId, status: "rejected", code: "INVALID_MODE" },
    ]);

    expect(gameplayState(engine.snapshot())).toEqual(gameplayState(before));
    expect(engine.events()).toEqual(beforeEvents);
    expect(engine.events().some((event) => event.causedByRequestId === requestId)).toBe(false);
    const records = engine.journalRecords();
    expect(records.some((record) => record.kind === "input_window" &&
      record.inputWindow.commands.some((command) => command.requestId === requestId))).toBe(true);
    expect(records.some((record) => record.kind === "event" && record.event.causedByRequestId === requestId)).toBe(false);
    expect(engine.snapshot().sceneRevision).toBe(before.sceneRevision);
  });

  it("admits moves independent of scene revision while enforcing actor, mode, and duplicate checks", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), hero("hero-2", 4, 4, null)],
      heroIdByActorId: { "actor-1": "hero-1", "actor-2": "hero-2" },
    }));
    expect(engine.submit(moveCommand("stale", "right", { revision: 99 }))).toMatchObject({ status: "queued" });
    expect(engine.events()).toHaveLength(0);
    expect(engine.submit(moveCommand("unauth", "right", { actorId: "unknown" }))).toMatchObject({ status: "rejected", code: "AUTH_FORBIDDEN" });
    expect(engine.submit(moveCommand("mode", "right", { actorId: "actor-2" }))).toMatchObject({ status: "queued" });
    const accepted = engine.submit(moveCommand("same", "right"));
    expect(accepted.status).toBe("queued");
    expect(engine.submit(moveCommand("same", "right"))).toMatchObject({ status: "duplicate", requestId: "same" });
    const applied = engine.advanceTicks(5).at(-1);
    expect(applied?.commandResults.find((result) => result.requestId === "mode"))
      .toMatchObject({ status: "rejected", code: "INVALID_MODE" });
    expect(applied?.commandResults.find((result) => result.requestId === "same"))
      .toMatchObject({ status: "accepted" });
    expect(engine.events()).toHaveLength(2);
    expect(engine.snapshot().sceneRevision).toBe(1);
  });

  it("scopes request IDs per actor and replays the finalized result on retry", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), hero("hero-2", 4, 4)],
      heroIdByActorId: { "actor-1": "hero-1", "actor-2": "hero-2" },
    }));

    const queued = engine.submit(moveCommand("local-1", "right", { actorId: "actor-1" }));
    expect(queued).toMatchObject({ status: "queued" });
    if (queued.status === "queued") queued.windowId = 99;
    expect(engine.submit(moveCommand("local-1", "right", { actorId: "actor-1" }))).toMatchObject({
      status: "duplicate", original: { status: "queued", windowId: 0 },
    });
    expect(engine.submit(moveCommand("local-1", "right", { actorId: "actor-2" }))).toMatchObject({ status: "queued" });

    const tick = engine.advanceTicks(5).at(-1);
    expect(tick?.commandResults.map(({ status }) => status)).toEqual(["accepted", "accepted"]);
    expect(engine.snapshot().entities.find(({ id }) => id === "hero-1")?.position).toEqual({ x: 2, y: 1 });
    expect(engine.snapshot().entities.find(({ id }) => id === "hero-2")?.position).toEqual({ x: 5, y: 4 });
    const firstTickResult = tick?.commandResults[0];
    if (firstTickResult?.status === "accepted") firstTickResult.eventIds.push("caller-mutated");

    const duplicate = engine.submit(moveCommand("local-1", "right", { actorId: "actor-1" }));
    expect(duplicate).toMatchObject({
      status: "duplicate",
      original: { status: "accepted", requestId: "local-1", eventIds: ["evt-1"], sceneRevision: 1 },
    });
    expect(engine.submit(moveCommand("local-1", "right", { actorId: "actor-2" }))).toMatchObject({
      status: "duplicate",
      original: { status: "accepted", requestId: "local-1", eventIds: ["evt-2"], sceneRevision: 1 },
    });
    expect(engine.events()).toHaveLength(2);
  });

  it("rejects malformed command envelopes safely without state or journal mutation", () => {
    const engine = createSimulationEngine(testConfig());
    const before = gameplayState(engine.snapshot());
    const invalidCommands = [
      null as never,
      { ...moveCommand("", "right"), requestId: "" },
      { ...moveCommand("x".repeat(121), "right") },
      { ...moveCommand("empty-session", "right"), sessionId: "" },
      { ...moveCommand("empty-actor", "right"), actorId: "" },
    ];

    for (const invalid of invalidCommands) {
      expect(engine.submit(invalid)).toMatchObject({ status: "rejected", code: "SCHEMA_INVALID" });
    }
    expect(gameplayState(engine.snapshot())).toEqual(before);
    expect(engine.events()).toHaveLength(0);
  });

  it("keeps event IDs distinct for same-requestId retreats whose damage events name enemy actors", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 3, 3, "melee"), hero("hero-2", 5, 3, "melee"), enemy("enemy-1", 4, 3)],
      heroIdByActorId: { "actor-1": "hero-1", "actor-2": "hero-2" },
    }));
    const revision = engine.snapshot().sceneRevision;
    engine.submit(modeCommand("player.enter_movement_mode", "retreat-local", { actorId: "actor-1", revision, sequence: 1 }));
    engine.submit(modeCommand("player.enter_movement_mode", "retreat-local", { actorId: "actor-2", revision, sequence: 2 }));

    const result = engine.advanceTicks(5).at(-1);
    const first = result?.commandResults[0];
    const second = result?.commandResults[1];
    if (!first || first.status !== "accepted" || !second || second.status !== "accepted") {
      throw new Error("both retreat commands should be accepted");
    }
    expect(first.eventIds).toHaveLength(2);
    expect(second.eventIds).toHaveLength(2);
    expect(first.eventIds).not.toEqual(second.eventIds);
    expect(first.eventIds.map((id) => result?.events.find((event) => event.eventId === id)?.eventType)).toEqual([
      "hp.changed", "mode.changed",
    ]);
    expect(second.eventIds.map((id) => result?.events.find((event) => event.eventId === id)?.eventType)).toEqual([
      "hp.changed", "mode.changed",
    ]);
  });

  it("returns the cached final rejection for a retried command that failed during resolution", () => {
    const engine = createSimulationEngine(testConfig({
      terrain: [{ cell: { x: 2, y: 1 }, terrain: "wall" }],
    }));
    engine.submit(moveCommand("blocked-retry", "right"));
    const tick = engine.advanceTicks(5).at(-1);
    expect(tick?.commandResults[0]).toMatchObject({ status: "rejected", code: "CELL_BLOCKED" });
    const beforeRetry = gameplayState(engine.snapshot());

    expect(engine.submit(moveCommand("blocked-retry", "right"))).toMatchObject({
      status: "duplicate",
      original: { status: "rejected", requestId: "blocked-retry", code: "CELL_BLOCKED", sceneRevision: 0 },
    });
    expect(gameplayState(engine.snapshot())).toEqual(beforeRetry);
    expect(engine.events()).toHaveLength(0);
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
