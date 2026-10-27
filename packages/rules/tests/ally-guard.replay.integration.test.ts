import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import type { IntentTemplate, StatusLayer } from "../src/engine/types.js";
import { enemy, hero, playCardCommand, testConfig, testEnemyTemplates, testIntentTemplates } from "./createTestEngine.js";

function createRefreshEngine() {
  return createSimulationEngine(testConfig({
    entities: [
      hero("hero-guard", 0, 8),
      enemy("enemy-guard", 1, 1, "test_refreshing_guard_enemy"),
      enemy("enemy-ally", 2, 1, "slag_shooter"),
      enemy("enemy-alt", 6, 6, "quarantine_chaser"),
    ],
    heroIdByActorId: { "actor-1": "hero-guard" },
    initialIntentByEnemyId: { "enemy-guard": "test_ally_guard_refresh" },
  }));
}

function createOneShotExpiryEngine() {
  const sourceIntent = testIntentTemplates.find((template) => template.key === "test_ally_guard_refresh");
  const sourceEnemy = testEnemyTemplates.find((template) => template.key === "test_refreshing_guard_enemy");
  if (!sourceIntent || !sourceEnemy) throw new Error("Ally Guard test fixture missing");
  const oneShotIntent: IntentTemplate = {
    ...sourceIntent,
    key: "test_ally_guard_once",
    targetRules: {
      ...sourceIntent.targetRules,
      filters: { ...sourceIntent.targetRules.filters, excludedStatuses: ["ally_guard"] },
    },
    fallbackKeys: ["hold_position"],
  };
  const oneShotEnemy = {
    ...sourceEnemy,
    key: "test_one_shot_guard_enemy",
    intentKeys: ["test_ally_guard_once", "hold_position"],
    initialIntentKey: "test_ally_guard_once",
  };
  return createSimulationEngine(testConfig({
    entities: [
      hero("hero-guard", 1, 1),
      { ...enemy("enemy-guard", 4, 4, "test_refreshing_guard_enemy"), templateKey: "test_one_shot_guard_enemy" },
      enemy("enemy-ally", 5, 4, "slag_shooter"),
    ],
    heroIdByActorId: { "actor-1": "hero-guard" },
    enemyTemplates: [...testEnemyTemplates, oneShotEnemy],
    intentTemplates: [...testIntentTemplates, oneShotIntent],
    initialIntentByEnemyId: { "enemy-guard": "test_ally_guard_once" },
  }));
}

function createGuardedDamageEngine() {
  const guard: StatusLayer = {
    id: "status:enemy-ally:ally_guard:enemy-extinguisher:replay-defense",
    templateKey: "ally_guard",
    sourceEntityId: "enemy-extinguisher",
    potency: 20,
    stacks: 1,
    appliedAtTick: 0,
    expiresAtTick: 300,
    refreshPolicy: "refresh_duration",
  };
  return createSimulationEngine(testConfig({
    entities: [
      hero("hero-attacker", 1, 1, "ranged", false, 3, {
        hand: [{ instanceId: "guarded-card", templateKey: "test-only-ranged-strike" }],
      }),
      enemy("enemy-extinguisher", 7, 7, "extinguisher"),
      { ...enemy("enemy-ally", 4, 1, "slag_shooter"), statuses: [guard] },
    ],
    heroIdByActorId: { "actor-1": "hero-attacker" },
    initialIntentByEnemyId: {},
  }));
}

describe("Ally Guard replay", () => {
  it("replays apply and refresh with preserved layer identity/source and renewed 300-tick deadline", () => {
    const engine = createRefreshEngine();
    engine.advanceTicks(600);
    const events = engine.events();
    expect(events.filter((event) => event.eventType === "status.applied" || event.eventType === "status.refreshed")
      .map((event) => event.eventType)).toEqual(["status.applied", "status.refreshed"]);

    const live = engine.snapshot();
    const target = live.entities.find((entity) => entity.id === "enemy-ally");
    expect(target?.statuses).toHaveLength(1);
    expect(target?.statuses[0]).toMatchObject({
      templateKey: "ally_guard",
      sourceEntityId: "enemy-guard",
      potency: 20,
      stacks: 1,
      appliedAtTick: 600,
      expiresAtTick: 900,
      refreshPolicy: "refresh_duration",
    });
    const applied = events.find((event) => event.eventType === "status.applied");
    const refreshed = events.find((event) => event.eventType === "status.refreshed");
    if (applied?.eventType !== "status.applied" || refreshed?.eventType !== "status.refreshed") {
      throw new Error("expected Ally Guard applied and refreshed events");
    }
    expect(refreshed.payload.layerId).toBe(applied.payload.layerId);

    const missingRefreshPotency = events.map((event) => structuredClone(event));
    const refreshIndex = missingRefreshPotency.findIndex((event) => event.eventType === "status.refreshed");
    const missingRefresh = missingRefreshPotency[refreshIndex];
    if (!missingRefresh || missingRefresh.eventType !== "status.refreshed") throw new Error("expected cloned status.refreshed");
    delete (missingRefresh.payload as { publicPotency?: number }).publicPotency;
    expect(() => engine.replay(missingRefreshPotency)).toThrow(/status\.refreshed/);

    const replayed = engine.replay(events);
    expect(replayed).toEqual(live);
    expect(engine.replayJournal()).toEqual(live);
    expect(stateHashFromSnapshot(replayed)).toBe(stateHashFromSnapshot(live));
  });

  it("replays deterministic Ally Guard expiry after the status remains active through its due tick", () => {
    const engine = createOneShotExpiryEngine();
    engine.advanceTicks(600);
    const events = engine.events();
    const guardEvents = events.filter((event) => event.eventType === "status.applied" || event.eventType === "status.expired");
    expect(guardEvents.map((event) => event.eventType)).toEqual(["status.applied", "status.expired"]);
    expect(guardEvents.at(-1)).toMatchObject({ eventType: "status.expired", serverTick: 600 });
    expect(engine.snapshot().entities.find((entity) => entity.id === "enemy-ally")?.statuses).toEqual([]);

    const live = engine.snapshot();
    expect(engine.replay(events)).toEqual(live);
    expect(engine.replayJournal()).toEqual(live);
    expect(stateHashFromSnapshot(engine.replay(events))).toBe(stateHashFromSnapshot(live));
  });

  it("rejects altered Ally Guard potency/timer and a missing status event or public potency", () => {
    const engine = createRefreshEngine();
    engine.advanceTicks(300);
    const events = engine.events();
    const appliedIndex = events.findIndex((event) => event.eventType === "status.applied");
    const applied = events[appliedIndex];
    if (!applied || applied.eventType !== "status.applied") throw new Error("expected status.applied");

    const alteredPotency = events.map((event) => structuredClone(event));
    const alteredApplied = alteredPotency[appliedIndex];
    if (!alteredApplied || alteredApplied.eventType !== "status.applied") throw new Error("expected cloned status.applied");
    alteredApplied.payload.publicPotency = 25;
    expect(() => engine.replay(alteredPotency)).toThrow(/status\.applied/);

    const missingPotency = events.map((event) => structuredClone(event));
    const missingPotencyEvent = missingPotency[appliedIndex];
    if (!missingPotencyEvent || missingPotencyEvent.eventType !== "status.applied") throw new Error("expected cloned status.applied");
    delete (missingPotencyEvent.payload as { publicPotency?: number }).publicPotency;
    expect(() => engine.replay(missingPotency)).toThrow(/status\.applied/);

    const alteredTimer = events.map((event) => structuredClone(event));
    const alteredTimerEvent = alteredTimer[appliedIndex];
    if (!alteredTimerEvent || alteredTimerEvent.eventType !== "status.applied") throw new Error("expected cloned status.applied");
    alteredTimerEvent.payload.timer.resolvesAtTick += 1;
    expect(() => engine.replay(alteredTimer)).toThrow(/status\.applied/);

    const resolvedIndex = events.findIndex((event) => event.eventType === "intent.resolved" && event.payload.effectKey === "ally_guard");
    expect(resolvedIndex).toBeGreaterThanOrEqual(0);
    expect(() => engine.replay(events.slice(0, resolvedIndex + 1)))
      .toThrow(/Replay ended before the Ally Guard status effect was recorded/);
  });

  it("rejects an altered target when the substitute is active but outside Ally Guard range", () => {
    const engine = createRefreshEngine();
    const events = engine.events();
    const targetEventIndex = events.findIndex((event) => event.eventType === "intent.target_selected");
    const targetEvent = events[targetEventIndex];
    if (!targetEvent || targetEvent.eventType !== "intent.target_selected") throw new Error("expected target selection");
    expect(targetEvent.payload.targetEntityId).toBe("enemy-ally");

    const tampered = events.map((event) => structuredClone(event));
    const changedTarget = tampered[targetEventIndex];
    if (!changedTarget || changedTarget.eventType !== "intent.target_selected") throw new Error("expected cloned target selection");
    changedTarget.payload.targetEntityId = "enemy-alt";
    changedTarget.payload.targetCell = { x: 6, y: 6 };
    expect(() => engine.replay(tampered)).toThrow(/intent\.target_selected/);
  });

  it("rejects a tampered effective defense in hp.changed while Ally Guard is active", () => {
    const engine = createGuardedDamageEngine();
    const snapshot = engine.snapshot();
    const attacker = snapshot.entities.find((entity) => entity.id === "hero-attacker");
    if (!attacker || attacker.kind !== "hero") throw new Error("expected attacker snapshot");
    engine.submit(playCardCommand("guarded-damage", "guarded-card", "enemy-ally", "ranged", {
      revision: snapshot.sceneRevision,
      cardRevision: attacker.cards.revision,
      targetCell: { x: 4, y: 1 },
    }));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.commandResults).toMatchObject([{ requestId: "guarded-damage", status: "accepted" }]);
    const events = engine.events();
    const damageIndex = events.findIndex((event) => event.eventType === "hp.changed" && event.eventVersion === 2);
    const damage = events[damageIndex];
    if (!damage || damage.eventType !== "hp.changed" || damage.eventVersion !== 2) throw new Error("expected hp.changed v2");
    expect(damage.payload.defense).toBe(12 * 1.2);

    const tampered = events.map((event) => structuredClone(event));
    const alteredDamage = tampered[damageIndex];
    if (!alteredDamage || alteredDamage.eventType !== "hp.changed" || alteredDamage.eventVersion !== 2) {
      throw new Error("expected cloned hp.changed v2");
    }
    alteredDamage.payload.defense = 12;
    expect(() => engine.replay(tampered)).toThrow(/hp\.changed v2/);
  });
});
