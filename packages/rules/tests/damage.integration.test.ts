import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { applyDamage } from "../src/combat/damage.js";
import { cleanupDeadEnemies } from "../src/engine/cleanup.js";
import { cloneRuntimeState, createRuntimeState, snapshotState } from "../src/engine/createRuntimeState.js";
import { activateScene, resolveDueIntents } from "../src/intents/intentSystem.js";
import { groupEvents } from "../src/intents/events.js";
import { replayEvents } from "../src/replay/replay.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { contactingEnemies } from "../src/combat/heroModes.js";
import { isEligibleTarget } from "../src/intents/targeting.js";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type { DomainEvent, IntentTemplate } from "../src/engine/types.js";
import { enemy, hero, modeCommand, testConfig, testIntentTemplates } from "./createTestEngine.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/event.schema.json", import.meta.url), "utf8")) as object;
const validateEvent = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

describe("authoritative damage and enemy HP cleanup", () => {
  it("makes a hero critically injured on lethal intent damage and rejects subsequent gameplay actions", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [
        { ...hero("hero-1", 2, 2, "movement", true), hp: { current: 50, max: 50 } },
        enemy("shooter-1", 0, 2, "slag_shooter"),
      ],
      initialIntentByEnemyId: { "shooter-1": "ranged_shot" },
    }));
    engine.advanceTicks(200);
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1"))
      .toMatchObject({ hp: { current: 0, max: 50 }, aliveState: "critically_injured" });

    const before = engine.snapshot();
    expect(engine.submit(modeCommand("player.enter_ranged_mode", "critical-hero-action", { revision: before.sceneRevision })))
      .toMatchObject({ status: "rejected", code: "AUTH_FORBIDDEN" });
    expect(engine.snapshot()).toEqual(before);
  });

  it("continues to replay a historical hp.changed v1 event", () => {
    const initial = createRuntimeState(testConfig({ entities: [hero("hero-1", 1, 1), enemy("enemy-1", 7, 7)] }));
    const legacyEvent: Extract<DomainEvent, { eventType: "hp.changed"; eventVersion: 1 }> = {
      protocolVersion: "fable.protocol.v1",
      schemaVersion: 1,
      eventId: "evt-1",
      eventVersion: 1,
      campaignId: "campaign-test",
      sessionId: "session-test",
      sceneId: "scene-test",
      sceneRevision: 1,
      serverTick: 0,
      serverSequence: 1,
      eventGroupId: "scene-1",
      eventIndex: 0,
      causedByRequestId: null,
      actorId: "enemy-1",
      replay: null,
      eventType: "hp.changed" as const,
      payload: { entityId: "hero-1", current: 883, maximum: 1_000, kind: "damage" as const, publicAmount: 117 },
    };

    expect(validateEvent(legacyEvent), JSON.stringify(validateEvent.errors)).toBe(true);
    const replayed = replayEvents(initial, [legacyEvent]);
    expect(replayed.entities.find((entity) => entity.id === "hero-1")?.hp.current).toBe(883);
  });

  it("excludes a zero-HP enemy immediately, then cancels its intent and removes it in one replayable event group", () => {
    const config = testConfig({
      entities: [hero("hero-1", 1, 1, "melee"), enemy("enemy-source", 7, 7), enemy("enemy-dead", 2, 1)],
      initialIntentByEnemyId: { "enemy-dead": "hold_position" },
    });
    const initial = createRuntimeState(config);
    const state = cloneRuntimeState(initial);
    const activationEvents = groupEvents(state, activateScene(state)).events;
    state.serverTick = 300;
    state.scene.inputWindow = { windowId: 60, commands: [] };

    const deadEnemy = state.entities.get("enemy-dead");
    if (!deadEnemy || deadEnemy.kind !== "enemy") throw new Error("dead enemy fixture missing");
    const heroEntity = state.entities.get("hero-1");
    if (!heroEntity || heroEntity.kind !== "hero") throw new Error("hero fixture missing");
    const sourceEnemy = state.entities.get("enemy-source");
    if (!sourceEnemy || sourceEnemy.kind !== "enemy") throw new Error("damage source fixture missing");
    const baseTargetTemplate = testIntentTemplates.find((template) => template.key === "hold_position");
    if (!baseTargetTemplate) throw new Error("target template fixture missing");
    const enemyTargetTemplate: IntentTemplate = {
      ...baseTargetTemplate,
      targetRules: {
        policy: "lowest_ally_hp_percentage",
        fallbackPolicies: [],
        range: null,
        lineOfSight: "not_required",
        filters: { factions: ["enemy"], aliveStates: ["active"], requiredStatuses: [], excludedStatuses: [] },
      },
    };
    expect(isEligibleTarget(state.scene.cells, sourceEnemy, deadEnemy, enemyTargetTemplate)).toBe(true);
    const damage = applyDamage(state, {
      target: deadEnemy,
      source: { kind: "retreat_attack", enemyId: "enemy-source", attackOrder: 1 },
      rawDamage: 2_000,
      multiplier: 1,
      serverTick: 300,
      causedByRequestId: null,
    });
    expect(damage.hpAfter).toBe(0);
    expect(isEligibleTarget(state.scene.cells, sourceEnemy, deadEnemy, enemyTargetTemplate)).toBe(false);
    expect(state.scene.cells[deadEnemy.position.y * 9 + deadEnemy.position.x]?.occupantId).toBe("enemy-dead");
    expect(contactingEnemies(state, heroEntity)).not.toContain("enemy-dead");
    expect(resolveDueIntents(state, 300)).toEqual([]);
    expect(deadEnemy.activeIntentId).not.toBeNull();

    const pending = damage.event ? [damage.event] : [];
    pending.push(...cleanupDeadEnemies(state, 300));
    const damageBatch = groupEvents(state, pending).events;
    const fullJournal = [...activationEvents, ...damageBatch];

    expect(damageBatch.map((event) => event.eventType)).toEqual([
      "hp.changed",
      "intent.cancelled",
      "scene.entity_removed",
    ]);
    expect(damageBatch[0]).toMatchObject({ eventType: "hp.changed", eventVersion: 2 });
    expect(damageBatch[1]).toMatchObject({
      eventType: "intent.cancelled",
      payload: { enemyId: "enemy-dead", reason: "owner_removed" },
    });
    expect(damageBatch[2]).toMatchObject({
      eventType: "scene.entity_removed",
      payload: { entityId: "enemy-dead", reason: "hp_depleted", cell: { x: 2, y: 1 } },
    });
    expect(damageBatch.every((event) => event.eventGroupId === damageBatch[0]?.eventGroupId)).toBe(true);
    expect(damageBatch.every((event) => event.sceneRevision === damageBatch[0]?.sceneRevision)).toBe(true);

    const removed = state.entities.get("enemy-dead");
    expect(removed).toMatchObject({ aliveState: "removed", hp: { current: 0 } });
    expect(state.scene.cells[11]?.occupantId).toBeNull();
    expect(state.activeIntents.size).toBe(0);
    for (const event of fullJournal) expect(validateEvent(event), JSON.stringify(validateEvent.errors)).toBe(true);

    const live = snapshotState(state);
    const replayed = replayEvents(initial, fullJournal);
    expect(replayed).toEqual(live);
    expect(stateHashFromSnapshot(replayed)).toBe(stateHashFromSnapshot(live));
  });
});
