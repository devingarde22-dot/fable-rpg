import { describe, expect, it } from "vitest";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type { DomainEvent } from "../src/engine/types.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

function engineWithIntent(enemyTemplateKey: string) {
  return createSimulationEngine(testConfig({
    entities: [hero("hero-status", 1, 1), enemy("enemy-bind", 7, 1, enemyTemplateKey)],
    heroIdByActorId: { "actor-status": "hero-status" },
    initialIntentByEnemyId: {
      "enemy-bind": enemyTemplateKey === "test_refreshing_bind_enemy" ? "test_bind_refresh" : "test_bind_once",
    },
  }));
}

describe("immobilized status replay", () => {
  it("replays applied and expired status events to the same final snapshot and hash", () => {
    const engine = engineWithIntent("test_binding_enemy");
    engine.advanceTicks(600);
    const events = engine.events();
    expect(events.some((event) => event.eventType === "status.applied")).toBe(true);
    expect(events.some((event) => event.eventType === "status.expired")).toBe(true);

    const live = engine.snapshot();
    const eventReplay = engine.replay(events);
    const journalReplay = engine.replayJournal();
    expect(eventReplay).toEqual(live);
    expect(journalReplay).toEqual(live);
    expect(stateHashFromSnapshot(eventReplay)).toBe(stateHashFromSnapshot(live));
  });

  it("replays refresh_duration with the preserved layer id and renewed deadline", () => {
    const engine = engineWithIntent("test_refreshing_bind_enemy");
    engine.advanceTicks(600);
    expect(engine.events().some((event) => event.eventType === "status.refreshed")).toBe(true);
    const live = engine.snapshot();
    expect(engine.replay(engine.events())).toEqual(live);
    expect(engine.replayJournal()).toEqual(live);
    expect(live.entities.find((entity) => entity.id === "hero-status")?.statuses[0]?.expiresAtTick).toBe(900);
  });

  it("rejects altered bind status timer data during replay", () => {
    const engine = engineWithIntent("test_binding_enemy");
    engine.advanceTicks(300);
    const tampered = engine.events().map((event) => structuredClone(event));
    const applied = tampered.find((event) => event.eventType === "status.applied");
    if (!applied || applied.eventType !== "status.applied") throw new Error("expected status.applied");
    applied.payload.timer.resolvesAtTick += 1;
    expect(() => engine.replay(tampered)).toThrow(/status\.applied/);
  });

  it("rejects a bind intent resolution whose status event is omitted", () => {
    const engine = engineWithIntent("test_binding_enemy");
    engine.advanceTicks(300);
    const events = engine.events();
    const resolvedIndex = events.findIndex((event) => event.eventType === "intent.resolved" && event.payload.effectKey === "bind");
    expect(resolvedIndex).toBeGreaterThanOrEqual(0);
    expect(() => engine.replay(events.slice(0, resolvedIndex + 1)))
      .toThrow(/Replay ended before the bind status effect was recorded/);
  });

  it("rejects a forged movement event during the immobilized interval", () => {
    const engine = engineWithIntent("test_binding_enemy");
    engine.advanceTicks(300);
    const events = engine.events();
    const live = engine.snapshot();
    const base = events.at(-1);
    if (!base) throw new Error("expected a committed event envelope");
    const nextRevision = live.sceneRevision + 1;
    const forgedMove = {
      ...base,
      eventId: `evt-${live.nextServerSequence}`,
      eventType: "scene.entity_moved",
      payload: { entityId: "hero-status", from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
      sceneRevision: nextRevision,
      serverTick: 305,
      serverSequence: live.nextServerSequence,
      eventGroupId: `scene-${nextRevision}`,
      eventIndex: 0,
      causedByRequestId: "forged-move",
      actorId: "actor-status",
      replay: null,
    } as unknown as DomainEvent;
    expect(() => engine.replay([...events, forgedMove])).toThrow(/active immobilized status/);
  });
});
