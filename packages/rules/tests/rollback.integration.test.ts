import { describe, expect, it } from "vitest";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { makeEngine, moveCommand } from "./createTestEngine.js";

describe("in-memory checkpoint and rollback", () => {
  it("restores a checkpoint without deleting history or rewinding sequence/revision/tick", () => {
    const engine = makeEngine();
    engine.advanceTicks(20);
    const checkpoint = engine.createCheckpoint("city-before-quarantine");
    const checkpointPosition = checkpoint.snapshot.entities.find((entity) => entity.id === "hero-1")?.position;
    const beforeRollbackHistory = engine.events().length;
    const checkpointSequence = engine.snapshot().nextServerSequence;
    const checkpointRevision = engine.snapshot().sceneRevision;

    engine.submit(moveCommand("move-after-save", "right", { revision: engine.snapshot().sceneRevision }));
    expect(engine.advanceTicks(5).at(-1)?.commandResults).toMatchObject([{ status: "accepted" }]);
    const beforeRollback = engine.snapshot();
    expect(beforeRollback.entities.find((entity) => entity.id === "hero-1")?.position).not.toEqual(checkpointPosition);

    const rolledBack = engine.rollback(checkpoint.checkpointId);
    expect(rolledBack.event).toMatchObject({
      eventType: "rollback.applied",
      payload: { checkpointId: checkpoint.checkpointId, targetRevision: checkpointRevision, restoredRevision: beforeRollback.sceneRevision + 1 },
    });
    expect(rolledBack.snapshot.serverTick).toBe(beforeRollback.serverTick);
    expect(rolledBack.snapshot.sceneRevision).toBeGreaterThan(beforeRollback.sceneRevision);
    expect(rolledBack.snapshot.nextServerSequence).toBeGreaterThan(checkpointSequence);
    expect(rolledBack.snapshot.entities.find((entity) => entity.id === "hero-1")?.position).toEqual(checkpointPosition);
    expect(engine.events()).toHaveLength(beforeRollbackHistory + 2);
    expect(engine.events().map((event) => event.eventType)).toContain("checkpoint.created");
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
  });
});
