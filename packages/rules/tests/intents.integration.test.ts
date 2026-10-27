import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { assertRuntimeInvariants } from "../src/engine/invariants.js";
import { replayEvents } from "../src/replay/replay.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { projectTargetSelectedEvent } from "../src/intents/intentEventProjection.js";
import type { ActiveIntent, IntentTemplate } from "../src/engine/types.js";
import { enemy, hero, testConfig, testEnemyTemplates, testIntentTemplates } from "./createTestEngine.js";

const getEvents = (engine: ReturnType<typeof createSimulationEngine>, eventType: string) =>
  engine.events().filter((event) => event.eventType === eventType);

describe("deterministic enemy intent simulation", () => {
  it("starts an authoritative move_close intent and moves up to two greedy cells when its timer expires", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 1)],
      initialIntentByEnemyId: { "enemy-1": "move_close" },
    }));
    const initial = engine.snapshot();
    const active = initial.activeIntents[0];
    expect(active).toMatchObject({ templateKey: "move_close", startedAtTick: 0, resolvesAtTick: 300, targetEntityId: "hero-1" });
    expect(getEvents(engine, "intent.started")).toHaveLength(1);
    expect(getEvents(engine, "intent.target_selected")).toHaveLength(1);
    expect(engine.state.sceneRevision).toBe(1);

    const result = engine.advanceTicks(300).at(-1);
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "intent.resolved",
      "scene.entity_moved",
      "intent.started",
      "intent.target_selected",
    ]);
    expect(engine.snapshot().entities.find((entity) => entity.id === "enemy-1")?.position).toEqual({ x: 5, y: 1 });
    expect(engine.snapshot().sceneRevision).toBe(2);
  });

  it("resolves melee_strike with the confirmed raw damage and defense mitigation", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 3, 3), enemy("enemy-1", 4, 3)],
      initialIntentByEnemyId: { "enemy-1": "melee_strike" },
    }));
    const result = engine.advanceTicks(120).at(-1);
    const damageEvent = result?.events.find((event) => event.eventType === "hp.changed");
    expect(result?.events.map((event) => event.eventType)).toEqual(["intent.resolved", "hp.changed", "intent.started", "intent.target_selected"]);
    expect(damageEvent?.eventType === "hp.changed" ? damageEvent.payload : undefined).toMatchObject({
      entityId: "hero-1",
      current: 883,
      maximum: 1_000,
      kind: "damage",
      publicAmount: 117,
    });
  });

  it("selects ranged targets by threat and seeded tie-break and resolves at the exact 20 Hz deadline", () => {
    const targetZ = { ...hero("hero-z", 6, 2), threat: 20 };
    const targetA = { ...hero("hero-a", 2, 2), threat: 20 };
    const config = testConfig({
      entities: [targetZ, targetA, enemy("shooter-1", 0, 2, "slag_shooter")],
      heroIdByActorId: { "actor-a": "hero-a", "actor-z": "hero-z" },
      initialIntentByEnemyId: { "shooter-1": "ranged_shot" },
    });
    const engine = createSimulationEngine(config);
    const repeat = createSimulationEngine(config);
    const selected = getEvents(engine, "intent.target_selected").find((event) => event.eventType === "intent.target_selected");
    const repeatedSelection = getEvents(repeat, "intent.target_selected").find((event) => event.eventType === "intent.target_selected");
    expect(selected?.eventType === "intent.target_selected" ? selected.payload : undefined).toMatchObject({
      selectionPolicy: "highest_threat",
      tieBreak: "seeded_random",
    });
    if (!selected || selected.eventType !== "intent.target_selected") throw new Error("expected target selection event");
    if (!repeatedSelection || repeatedSelection.eventType !== "intent.target_selected") throw new Error("expected repeated target selection event");
    expect(["hero-a", "hero-z"]).toContain(selected.payload.targetEntityId);
    expect(repeatedSelection.payload.targetEntityId).toBe(selected.payload.targetEntityId);
    expect(selected.payload.seedRef).toMatch(/^[0-9a-f]{64}$/);
    const auditRecord = engine.journalRecords().find((record) => record.kind === "event" && record.event.eventId === selected.eventId);
    expect(auditRecord?.kind === "event" ? auditRecord.rngAudit[0]?.rngStateAfter : undefined)
      .not.toEqual(auditRecord?.kind === "event" ? auditRecord.rngAudit[0]?.rngStateBefore : undefined);

    const early = engine.advanceTicks(199).at(-1);
    expect(early?.events).toEqual([]);
    const resolved = engine.advanceOneTick();
    const damage = resolved.events.find((event) => event.eventType === "hp.changed");
    expect(resolved.serverTick).toBe(200);
    expect(damage?.eventType === "hp.changed" ? damage.payload.current : undefined).toBe(908);
    expect(resolved.events.map((event) => event.eventType)).toEqual([
      "intent.resolved",
      "hp.changed",
      "intent.started",
      "intent.target_selected",
    ]);
  });

  it("filters inactive, out-of-range, and line-of-sight-blocked targets before threat ranking", () => {
    const inactiveHighThreat = { ...hero("hero-inactive", 2, 2), aliveState: "critically_injured" as const, threat: 100 };
    const blockedHighThreat = { ...hero("hero-blocked", 0, 5), threat: 90 };
    const visibleTarget = { ...hero("hero-visible", 2, 3), threat: 10 };
    const outOfRangeTarget = { ...hero("hero-far", 8, 8), threat: 999 };
    const engine = createSimulationEngine(testConfig({
      terrain: [
        { cell: { x: 1, y: 2 }, terrain: "wall" },
        { cell: { x: 0, y: 4 }, terrain: "statue" },
      ],
      entities: [inactiveHighThreat, blockedHighThreat, visibleTarget, outOfRangeTarget, enemy("shooter-1", 0, 2, "slag_shooter")],
      heroIdByActorId: { "actor-visible": "hero-visible" },
      initialIntentByEnemyId: { "shooter-1": "ranged_shot" },
    }));
    const selected = getEvents(engine, "intent.target_selected").find((event) => event.eventType === "intent.target_selected");
    expect(selected?.eventType === "intent.target_selected" ? selected.payload : undefined).toMatchObject({
      targetEntityId: "hero-visible",
      selectionPolicy: "highest_threat",
      tieBreak: "single_candidate",
    });
  });

  it("cancels an impossible move_close once and starts its first valid ordered fallback", () => {
    const engine = createSimulationEngine(testConfig({
      terrain: [
        { cell: { x: 6, y: 7 }, terrain: "wall" },
        { cell: { x: 7, y: 6 }, terrain: "statue" },
      ],
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 7)],
      initialIntentByEnemyId: { "enemy-1": "move_close" },
    }));
    const result = engine.advanceTicks(300).at(-1);
    const cancelled = result?.events.find((event) => event.eventType === "intent.cancelled");
    expect(cancelled?.eventType === "intent.cancelled" ? cancelled.payload.reason : undefined).toBe("path_blocked");
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "intent.cancelled",
      "intent.started",
    ]);
    expect(engine.snapshot().activeIntents[0]?.templateKey).toBe("hold_position");
    expect(engine.journalRecords().some((record) => record.kind === "event" && record.rngAudit.some((audit) => audit.forkInput.purpose === "fallback_selection"))).toBe(true);
  });

  it("emits no_valid_fallback once when no registered valid fallback exists and never retries in the same tick", () => {
    const baseMoveClose = testIntentTemplates.find((template) => template.key === "move_close");
    const chaser = testEnemyTemplates.find((template) => template.key === "quarantine_chaser");
    if (!baseMoveClose || !chaser) throw new Error("required test templates missing");
    const impossible: IntentTemplate = { ...baseMoveClose, key: "impossible_move", durationMs: 3_000, fallbackKeys: [] };
    const enemyTemplate = { ...chaser, intentKeys: ["impossible_move"], initialIntentKey: "impossible_move" };
    const engine = createSimulationEngine(testConfig({
      terrain: [
        { cell: { x: 7, y: 8 }, terrain: "wall" },
        { cell: { x: 8, y: 7 }, terrain: "statue" },
      ],
      entities: [hero("hero-1", 0, 0), enemy("enemy-1", 8, 8)],
      enemyTemplates: [enemyTemplate],
      intentTemplates: [impossible],
      initialIntentByEnemyId: { "enemy-1": "impossible_move" },
    }));
    const result = engine.advanceTicks(60).at(-1);
    expect(result?.events.map((event) => event.eventType)).toEqual(["intent.cancelled"]);
    expect(result?.events[0]?.eventType === "intent.cancelled" ? result.events[0].payload.reason : undefined).toBe("no_valid_fallback");
    expect(engine.snapshot().activeIntents).toEqual([]);
    expect(engine.advanceOneTick().events).toEqual([]);
  });

  it("rejects a draft or unsupported initial handler instead of silently starting no intent", () => {
    const holdPosition = testIntentTemplates.find((template) => template.key === "hold_position");
    const chaser = testEnemyTemplates.find((template) => template.key === "quarantine_chaser");
    if (!holdPosition || !chaser) throw new Error("required test templates missing");
    const deferredReposition: IntentTemplate = {
      ...holdPosition,
      key: "reposition",
      status: "draft",
      effect: { handler: "reposition", parameters: {} },
    };
    expect(() => createSimulationEngine(testConfig({
      enemyTemplates: [{ ...chaser, intentKeys: [...chaser.intentKeys, "reposition"] }],
      intentTemplates: [...testIntentTemplates, deferredReposition],
      initialIntentByEnemyId: { "enemy-1": "reposition" },
    }))).toThrow(/reposition.*confirmed/i);
  });

  it("enforces timer resolvesAtTick from registered durationMs divided by 50", () => {
    const config = testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 1)],
      initialIntentByEnemyId: { "enemy-1": "hold_position" },
    });
    const runtime = createRuntimeState(config);
    const enemyRuntime = runtime.entities.get("enemy-1");
    const holdTemplate = runtime.intentTemplates.get("hold_position");
    if (!enemyRuntime || enemyRuntime.kind !== "enemy" || !holdTemplate) throw new Error("expected timer test fixture");
    runtime.phase = "active";
    const active: ActiveIntent = {
      activeIntentId: "scene-test:enemy-1:0:hold_position",
      ownerEntityId: enemyRuntime.id,
      templateKey: holdTemplate.key,
      state: "telegraphed",
      startedAtTick: 0,
      resolvesAtTick: holdTemplate.durationMs / 50,
      targetEntityId: null,
      targetCell: null,
      publicTargetCell: null,
      selectionPolicy: holdTemplate.targetRules.policy,
      seedRef: null,
      cancelReason: null,
    };
    enemyRuntime.activeIntentId = active.activeIntentId;
    runtime.activeIntents.set(active.activeIntentId, active);
    assertRuntimeInvariants(runtime);
    active.resolvesAtTick += 1;
    expect(() => assertRuntimeInvariants(runtime)).toThrow(/invalid template or timer/);

    const replayEngine = createSimulationEngine(config);
    const events = replayEngine.events();
    const started = events.find((event) => event.eventType === "intent.started");
    if (started?.eventType !== "intent.started") throw new Error("expected intent.started event");
    started.payload.timer.durationMs += 50;
    started.payload.timer.resolvesAtTick += 1;
    expect(() => replayEvents(createRuntimeState(config), events)).toThrow(/timer\/template payload is inconsistent/);
  });

  it("keeps target-selection audience projections free of GM-only target identity and seed metadata", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 1)],
      initialIntentByEnemyId: { "enemy-1": "move_close" },
    }));
    const event = getEvents(engine, "intent.target_selected")[0];
    if (!event || event.eventType !== "intent.target_selected") throw new Error("expected target_selected event");
    const hiddenProjection = projectTargetSelectedEvent(event, "tv");
    const tvProjection = projectTargetSelectedEvent(event, "tv", event.payload.targetCell);
    const playerProjection = projectTargetSelectedEvent(event, "player", event.payload.targetCell);
    const gmProjection = projectTargetSelectedEvent(event, "gm");
    expect(hiddenProjection.payload).not.toHaveProperty("targetCell");
    expect(tvProjection.payload).not.toHaveProperty("targetEntityId");
    expect(tvProjection.payload).not.toHaveProperty("selectionPolicy");
    expect(tvProjection.payload).not.toHaveProperty("seedRef");
    expect(playerProjection).toEqual(tvProjection);
    expect(gmProjection).toEqual(event);
  });

  it("replays 305 ticks from the append-only journal to the exact live state hash", () => {
    const config = testConfig({
      rootSeed: "intent-replay-seed-v1",
      entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 1)],
      initialIntentByEnemyId: { "enemy-1": "move_close" },
    });
    const first = createSimulationEngine(config);
    const second = createSimulationEngine(config);
    first.advanceTicks(305);
    second.advanceTicks(305);
    const live = first.snapshot();
    const replayed = first.replayJournal();
    expect(live.serverTick).toBe(305);
    expect(first.journalRecords().filter((record) => record.kind === "tick").length).toBe(306);
    expect(replayed).toEqual(live);
    expect(stateHashFromSnapshot(replayed)).toBe(stateHashFromSnapshot(live));
    expect(second.snapshot()).toEqual(live);
    expect(second.events()).toEqual(first.events());
  });

  it("matches the fixed-seed golden intent transcript", () => {
    const config = testConfig({
      rootSeed: "fable-step-c-001",
      entities: [
        { ...hero("hero-a", 2, 2), threat: 20 },
        { ...hero("hero-z", 6, 2), threat: 20 },
        enemy("shooter-1", 0, 2, "slag_shooter"),
      ],
      heroIdByActorId: { "actor-a": "hero-a", "actor-z": "hero-z" },
      initialIntentByEnemyId: { "shooter-1": "ranged_shot" },
    });
    const engine = createSimulationEngine(config);
    engine.advanceTicks(200);
    const actual = {
      rootSeed: config.rootSeed,
      serverTick: engine.snapshot().serverTick,
      events: engine.events(),
      rngAudit: engine.journalRecords().flatMap((record) =>
        record.kind === "event" && record.rngAudit.length > 0
          ? [{ eventId: record.event.eventId, records: record.rngAudit }]
          : [],
      ),
      finalStateHash: stateHashFromSnapshot(engine.snapshot()),
    };
    const goldenPath = new URL("./intent-golden.transcript.json", import.meta.url);
    if (process.env.UPDATE_FABLE_GOLDEN === "1") {
      writeFileSync(fileURLToPath(goldenPath), `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(goldenPath, "utf8")) as typeof actual;
    expect(actual).toEqual(expected);
  });
});
