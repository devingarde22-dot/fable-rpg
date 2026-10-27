import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { enemy, hero, modeCommand, moveCommand, testConfig } from "./createTestEngine.js";

const entityById = (engine: ReturnType<typeof createSimulationEngine>, id: string) =>
  engine.snapshot().entities.find((entity) => entity.id === id);

describe("hero modes and automatic melee contact", () => {
  it("enters melee automatically after a hero move reaches diagonal contact", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 3, 2)],
    }));
    expect(engine.submit(moveCommand("contact-move", "right")).status).toBe("queued");
    const result = engine.advanceTicks(5).at(-1);

    expect(result?.events.map((event) => event.eventType)).toEqual(["scene.entity_moved", "mode.changed"]);
    expect(entityById(engine, "hero-1")).toMatchObject({ position: { x: 2, y: 1 }, mode: "melee" });
    expect(result?.events[1]).toMatchObject({
      eventType: "mode.changed",
      causedByRequestId: "contact-move",
      payload: { heroId: "hero-1", from: "movement", to: "melee", reason: "contact" },
    });
    expect(result?.events.map((event) => [event.eventGroupId, event.sceneRevision])).toEqual([
      [result?.events[0]?.eventGroupId, 1],
      [result?.events[0]?.eventGroupId, 1],
    ]);
  });

  it("accepts ranged mode only when the authoritative fixture capability is true", () => {
    const unavailable = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false)],
    }));
    expect(unavailable.submit(modeCommand("player.enter_ranged_mode", "no-ranged-card")))
      .toMatchObject({ status: "rejected", code: "CARD_NOT_AVAILABLE" });
    expect(unavailable.advanceTicks(5).at(-1)?.events).toEqual([]);

    const available = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", true)],
    }));
    const beforeHash = stateHashFromSnapshot(unavailable.snapshot());
    const afterHash = stateHashFromSnapshot(available.snapshot());
    expect(beforeHash).not.toBe(afterHash);
    expect(available.submit(modeCommand("player.enter_ranged_mode", "enter-ranged")).status).toBe("queued");
    const result = available.advanceTicks(5).at(-1);
    expect(result?.events.map((event) => event.eventType)).toEqual(["mode.changed"]);
    expect(entityById(available, "hero-1")).toMatchObject({ mode: "ranged", canEnterRangedMode: true });
    expect(result?.events[0]).toMatchObject({
      eventType: "mode.changed",
      causedByRequestId: "enter-ranged",
      payload: { from: "movement", to: "ranged", reason: "command" },
    });
  });

  it("checks contact after ranged-to-movement transition without running retreat", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "melee", true), enemy("enemy-1", 2, 1)],
    }));
    engine.submit(modeCommand("player.enter_movement_mode", "retreat"));
    engine.advanceTicks(5);
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "movement" });
    const hpAfterRetreat = entityById(engine, "hero-1")?.hp.current;
    expect(engine.snapshot().scene.contactImmunityUntilTick.get("hero-1")).toBe(305);

    engine.submit(modeCommand("player.enter_ranged_mode", "enter-ranged", { revision: 1 }));
    engine.advanceTicks(5);
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "ranged" });
    engine.advanceTicks(295);
    expect(engine.snapshot().serverTick).toBe(305);

    engine.submit(modeCommand("player.enter_movement_mode", "leave-ranged", { revision: 2 }));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.events.map((event) => event.eventType)).toEqual(["mode.changed", "mode.changed"]);
    expect(result?.events.map((event) => event.eventType === "mode.changed" ? event.payload.reason : "")).toEqual([
      "command",
      "contact",
    ]);
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "melee", hp: { current: hpAfterRetreat } });
    expect(engine.snapshot().scene.contactImmunityUntilTick.get("hero-1")).toBe(305);
    expect(result?.events.every((event) => event.causedByRequestId === "leave-ranged")).toBe(true);
  });

  it("checks contact after enemy movement in the enemies phase and leaves scheduler timing intact", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 4, 1)],
      initialIntentByEnemyId: { "enemy-1": "move_close" },
    }));
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "movement" });
    const result = engine.advanceTicks(300).at(-1);
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "intent.resolved",
      "scene.entity_moved",
      "intent.started",
      "intent.target_selected",
      "mode.changed",
    ]);
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "melee" });
    expect(result?.events.at(-1)).toMatchObject({
      eventType: "mode.changed",
      payload: { from: "movement", to: "melee", reason: "contact" },
    });
    expect(engine.snapshot().activeIntents[0]?.templateKey).toBe("melee_strike");
  });

  it("resolves retreat HP events then mode.changed in one event group and one revision", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-1", 4, 4, "melee"),
        enemy("enemy-b", 5, 4, "slag_shooter"),
        enemy("enemy-a", 3, 4, "quarantine_chaser"),
      ],
    }));
    const beforeRevision = engine.snapshot().sceneRevision;
    engine.submit(modeCommand("player.enter_movement_mode", "retreat-ordered"));
    const result = engine.advanceTicks(5).at(-1);

    expect(result?.events.map((event) => event.eventType)).toEqual(["hp.changed", "hp.changed", "mode.changed"]);
    expect(result?.events.filter((event) => event.eventType === "hp.changed").map((event) => event.actorId)).toEqual([
      "enemy-a",
      "enemy-b",
    ]);
    expect(result?.events.at(-1)).toMatchObject({
      eventType: "mode.changed",
      payload: { from: "melee", to: "movement", reason: "retreat" },
    });
    expect(result?.events.map((event) => event.eventGroupId)).toEqual(["scene-1", "scene-1", "scene-1"]);
    expect(result?.events.map((event) => event.sceneRevision)).toEqual([1, 1, 1]);
    expect(result?.commandResults[0]).toMatchObject({ status: "accepted", sceneRevision: 1 });
    const acceptedCommand = result?.commandResults[0];
    if (!acceptedCommand || acceptedCommand.status !== "accepted") throw new Error("retreat command was not accepted");
    expect(acceptedCommand.eventIds).toHaveLength(3);
    expect(result?.sceneRevision).toBe(beforeRevision + 1);
    expect(engine.snapshot().scene.contactImmunityUntilTick.get("hero-1")).toBe(305);
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "movement", hp: { current: 841 } });
    expect(result?.events.some((event) => String(event.eventType).startsWith("status."))).toBe(false);
  });

  it("keeps a due enemy intent in the normal enemy phase after retreat", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "melee"), enemy("enemy-1", 2, 1)],
      initialIntentByEnemyId: { "enemy-1": "hold_position" },
    }));
    engine.advanceTicks(295);
    expect(engine.submit(modeCommand("player.enter_movement_mode", "retreat-at-deadline", { revision: 1 })).status).toBe("queued");
    const result = engine.advanceTicks(5).at(-1);

    expect(result?.serverTick).toBe(300);
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "hp.changed",
      "mode.changed",
      "intent.resolved",
      "intent.started",
      "intent.target_selected",
    ]);
    expect(result?.events[2]).toMatchObject({ eventType: "intent.resolved", payload: { enemyId: "enemy-1", effectKey: "hold_position" } });
    expect(result?.events.some((event) => event.eventType === "intent.cancelled")).toBe(false);
    expect(engine.snapshot().activeIntents[0]?.templateKey).toBe("melee_strike");
    expect(result?.events.every((event) => event.eventGroupId === "scene-2" && event.sceneRevision === 2)).toBe(true);
  });

  it("replays mode, HP, immunity and accepted retreat exactly across later quiet ticks", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-1", 4, 4, "melee"),
        enemy("enemy-a", 3, 4),
        enemy("enemy-b", 5, 4, "slag_shooter"),
      ],
    }));
    engine.submit(modeCommand("player.enter_movement_mode", "retreat-replay"));
    engine.advanceTicks(5);
    const liveAfterCommand = engine.snapshot();
    const replayedFromEvents = engine.replay(engine.events());
    expect(replayedFromEvents).toEqual(liveAfterCommand);
    expect(stateHashFromSnapshot(replayedFromEvents)).toBe(stateHashFromSnapshot(liveAfterCommand));

    engine.advanceTicks(125);
    const live = engine.snapshot();
    const replayedFromJournal = engine.replayJournal();
    expect(replayedFromJournal).toEqual(live);
    expect(stateHashFromSnapshot(replayedFromJournal)).toBe(stateHashFromSnapshot(live));
    expect(replayedFromJournal.scene.contactImmunityUntilTick.get("hero-1")).toBe(305);
    expect(replayedFromJournal.entities.find((entity) => entity.id === "hero-1")).toMatchObject({ mode: "movement", hp: { current: 841 } });
  });
});


describe("mode transition entry points", () => {
  it("detects diagonal contact during scene activation", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 2, 2)],
    }));
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "melee" });
    expect(engine.events()).toHaveLength(1);
    expect(engine.events()[0]).toMatchObject({
      eventType: "mode.changed",
      sceneRevision: 1,
      payload: { from: "movement", to: "melee", reason: "contact" },
    });
  });

  it("enters movement from out_of_combat through the authoritative mode command", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, null)],
    }));
    engine.submit(modeCommand("player.enter_movement_mode", "start-moving"));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.events[0]).toMatchObject({
      eventType: "mode.changed",
      causedByRequestId: "start-moving",
      payload: { from: "out_of_combat", to: "movement", reason: "command" },
    });
    expect(entityById(engine, "hero-1")).toMatchObject({ mode: "movement" });
  });
});
