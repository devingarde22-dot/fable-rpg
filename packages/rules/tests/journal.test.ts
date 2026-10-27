import { describe, expect, it } from "vitest";
import { EventJournal } from "../src/journal/EventJournal.js";
import { makeEngine, moveCommand } from "./createTestEngine.js";

describe("EventJournal", () => {
  it("retains appended events and returns defensive copies", () => {
    const engine = makeEngine();
    engine.submit(moveCommand("move-1", "right"));
    engine.advanceTicks(5);
    const journal = new EventJournal();
    const event = engine.events().find((candidate) => candidate.eventType === "scene.entity_moved");
    if (!event || event.eventType !== "scene.entity_moved") throw new Error("expected movement event");
    journal.appendBatch([event]);
    const copy = journal.events().find((candidate) => candidate.eventType === "scene.entity_moved");
    expect(journal.length).toBe(1);
    if (copy?.eventType === "scene.entity_moved") copy.payload.to.x = 8;
    const stored = journal.events().find((candidate) => candidate.eventType === "scene.entity_moved");
    expect(stored?.eventType === "scene.entity_moved" ? stored.payload.to.x : undefined).toBe(2);
    expect(() => journal.appendBatch([event])).toThrow(/increase strictly/);
  });
});
