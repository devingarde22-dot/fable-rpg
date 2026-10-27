import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type { SchedulerPhase } from "../src/scheduler/orderCommands.js";
import { gameplayState, hero, moveCommand, testConfig } from "./createTestEngine.js";

describe("authoritative scheduler", () => {
  it("does not execute before the 250 ms window closes at tick five", () => {
    const engine = createSimulationEngine(testConfig());
    engine.submit(moveCommand("window-move", "right"));
    const firstFour = engine.advanceTicks(4);
    expect(firstFour.every((result) => result.events.length === 0)).toBe(true);
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")?.position).toEqual({ x: 1, y: 1 });
    const closingTick = engine.advanceOneTick();
    expect(closingTick.serverTick).toBe(5);
    expect(closingTick.closedWindowId).toBe(0);
    expect(closingTick.events).toHaveLength(1);
  });

  it("increments sceneRevision only for an accepted batch and never for a rejected command", () => {
    const engine = createSimulationEngine(testConfig({
      terrain: [{ cell: { x: 3, y: 1 }, terrain: "wall" }],
    }));
    expect(engine.state.sceneRevision).toBe(0);
    engine.submit(moveCommand("accepted-batch", "right", { revision: 0 }));
    expect(engine.state.sceneRevision).toBe(0);
    engine.advanceTicks(4);
    expect(engine.state.sceneRevision).toBe(0);
    const accepted = engine.advanceOneTick();
    expect(accepted.commandResults).toMatchObject([{ requestId: "accepted-batch", status: "accepted", sceneRevision: 1 }]);
    expect(engine.state.sceneRevision).toBe(1);

    const rejectedReceipt = engine.submit(moveCommand("rejected-batch", "right", { revision: 1 }));
    expect(rejectedReceipt).toMatchObject({ status: "queued" });
    const beforeRejectedWindow = engine.snapshot();
    const rejectedWindow = engine.advanceTicks(5).at(-1);
    const afterRejectedWindow = engine.snapshot();
    expect(rejectedWindow?.commandResults).toMatchObject([{ requestId: "rejected-batch", status: "rejected", code: "CELL_BLOCKED" }]);
    expect(rejectedWindow?.sceneRevision).toBe(1);
    expect(gameplayState(afterRejectedWindow)).toEqual(gameplayState(beforeRejectedWindow));
    expect(afterRejectedWindow.serverTick).toBe(beforeRejectedWindow.serverTick + 5);
    expect(afterRejectedWindow.scene.inputWindow.windowId).toBe(beforeRejectedWindow.scene.inputWindow.windowId + 1);
    expect(afterRejectedWindow.scene.inputWindow.commands).toEqual([]);
    expect(engine.events()).toHaveLength(1);
  });

  it("runs players → enemies → environment when simultaneous player requests close", () => {
    const phases: SchedulerPhase[] = [];
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), hero("hero-2", 6, 6)],
      heroIdByActorId: { "actor-1": "hero-1", "actor-2": "hero-2" },
    }), { onPhase: (phase) => phases.push(phase) });
    engine.submit(moveCommand("player-1", "right", { sequence: 2 }));
    engine.submit(moveCommand("player-2", "left", { actorId: "actor-2", sequence: 1 }));
    const result = engine.advanceTicks(5).at(-1);
    expect(phases).toEqual(Array.from({ length: 5 }, () => ["players", "enemies", "environment", "resources", "cards"]).flat());
    expect(result?.commandResults.map((entry) => entry.status)).toEqual(["accepted", "accepted"]);
    expect(result?.events.map((event) => event.causedByRequestId)).toEqual(["player-2", "player-1"]);
    expect(result?.events.map((event) => event.eventIndex)).toEqual([0, 1]);
  });
});
