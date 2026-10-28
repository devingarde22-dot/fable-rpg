import { describe, expect, it } from "vitest";
import { HeadlessCampaign } from "../src/campaign/HeadlessCampaign.js";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import type { InternalCommand, SimulationEngineConfig } from "../src/engine/types.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { enemy, hero, modeCommand, moveCommand, playCardCommand, testConfig } from "./createTestEngine.js";
import { createQuarantineGatesEngine, quarantineGatesConfig, QUARANTINE_GATES_START_CELLS } from "./fixtures/quarantineGates.js";
import { testAllyGuardCard, testDamageBarrier, testGoldenFinisher } from "./fixtures/testCards.js";

function emptySceneEngine() {
  return createSimulationEngine(testConfig({ entities: [hero("hero-1", 1, 1)], heroIdByActorId: { "actor-1": "hero-1" } }));
}

function campaign(engine = emptySceneEngine()) {
  const result = new HeadlessCampaign(engine, "mirevalt");
  result.enterRoute("avenrenn-road");
  result.enterNode("quarantine-gates");
  result.startScene();
  return result;
}

function submitWindow(engine: ReturnType<typeof createSimulationEngine>, commands: InternalCommand[]) {
  for (const command of commands) expect(engine.submit(command).status).toBe("queued");
  const frame = engine.advanceTicks(5).at(-1);
  for (const command of commands) {
    expect(frame?.commandResults).toContainEqual(expect.objectContaining({ requestId: command.requestId, status: "accepted" }));
  }
  return frame?.events ?? [];
}

describe("headless campaign loop", () => {
  it.each([2, 3, 4])("builds a deterministic Quarantine Gates fixture for %i heroes", (partySize) => {
    const first = createQuarantineGatesEngine(partySize);
    const second = createQuarantineGatesEngine(partySize);
    const heroes = first.snapshot().entities.filter((entity) => entity.kind === "hero");
    expect(heroes).toHaveLength(partySize);
    expect(first.snapshot().heroIdByActorId).toHaveLength(partySize);
    expect(first.snapshot().scene.width).toBe(9);
    expect(first.snapshot().scene.height).toBe(9);
    expect(first.snapshot().entities.filter((entity) => entity.kind === "enemy")).toHaveLength(3);
    expect(heroes.map((entity) => entity.position)).toEqual(QUARANTINE_GATES_START_CELLS.slice(0, partySize));
    expect(stateHashFromSnapshot(first.snapshot())).toBe(stateHashFromSnapshot(second.snapshot()));
  });

  it("runs the Quarantine Gates fixed-seed opening through movement, intents and replay", () => {
    const runOpening = () => {
      const engine = createQuarantineGatesEngine(4);
      const active = engine.snapshot().activeIntents;
      expect(active.find((intent) => intent.ownerEntityId === "enemy-chaser")?.templateKey).toBe("move_close");
      expect(active.find((intent) => intent.ownerEntityId === "enemy-shooter")?.templateKey).toBe("ranged_shot");
      expect(active.find((intent) => intent.ownerEntityId === "enemy-extinguisher")?.templateKey).toBe("ally_guard");
      engine.submit(moveCommand("qg-hero-one-step", "right", {
        actorId: "actor-1", sessionId: "session-quarantine-gates", revision: engine.snapshot().sceneRevision,
      }));
      engine.advanceTicks(5);
      engine.advanceTicks(300);
      const transcript = engine.events().map((event) => event.eventType);
      expect(transcript).toContain("scene.entity_moved");
      expect(transcript).toContain("intent.resolved");
      expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
      return { transcript, finalStateHash: stateHashFromSnapshot(engine.snapshot()) };
    };
    expect(runOpening()).toEqual(runOpening());
  });

  it("runs one full fixed-seed Quarantine Gates fight from city entry to success", () => {
    const runGoldenFight = () => {
      const base = quarantineGatesConfig(4);
      const sessionId = base.sessionId;
      const entities = base.entities.map((entity) => {
        if (entity.kind !== "hero") return entity;
        return {
          ...entity,
          threat: entity.id === "hero-4" ? 100 : entity.threat,
          cards: {
            ...entity.cards,
            hand: entity.cards.hand.map((card, index) => index === 0 ? { ...card, templateKey: testGoldenFinisher.key } : card),
            defenseSlot: entity.id === "hero-4"
              ? { instanceId: "hero-4-barrier", templateKey: testDamageBarrier.key }
              : entity.id === "hero-3"
                ? { instanceId: "hero-3-guard", templateKey: testAllyGuardCard.key }
                : entity.cards.defenseSlot,
          },
        };
      });
      const engine = createSimulationEngine({
        ...base,
        entities,
      });
      const run = new HeadlessCampaign(engine, "mirevalt");
      run.enterRoute("avenrenn-road");
      run.enterNode("quarantine-gates");
      run.startScene();
      const session = sessionId;
      const revision = () => engine.snapshot().sceneRevision;
      const cardRevision = (heroId: string) => {
        const entity = engine.snapshot().entities.find((candidate) => candidate.id === heroId);
        if (!entity || entity.kind !== "hero") throw new Error(`Missing ${heroId}`);
        return entity.cards.revision;
      };

      submitWindow(engine, [
        moveCommand("qg-fight-hero1-move", "right", { actorId: "actor-1", sessionId: session, revision: revision() }),
        playCardCommand("qg-fight-barrier", "hero-4-barrier", "hero-4", "movement", {
          actorId: "actor-4", sessionId: session, revision: revision(), cardRevision: cardRevision("hero-4"),
        }),
      ]);
      submitWindow(engine, [
        modeCommand("player.enter_ranged_mode", "qg-fight-hero1-ranged", { actorId: "actor-1", sessionId: session, revision: revision() }),
        moveCommand("qg-fight-hero4-step1", "right", { actorId: "actor-4", sessionId: session, revision: revision() }),
      ]);
      engine.advanceTicks(190);
      engine.advanceTicks(100);
      submitWindow(engine, [
        modeCommand("player.enter_ranged_mode", "qg-fight-hero2-ranged", { actorId: "actor-2", sessionId: session, revision: revision() }),
        moveCommand("qg-fight-hero4-step2", "right", { actorId: "actor-4", sessionId: session, revision: revision() }),
      ]);
      submitWindow(engine, [
        playCardCommand("qg-fight-kill-shooter", "hero-2-card-1", "enemy-shooter", "ranged", {
          actorId: "actor-2", sessionId: session, revision: revision(), cardRevision: cardRevision("hero-2"),
        }),
        modeCommand("player.enter_ranged_mode", "qg-fight-hero3-ranged", { actorId: "actor-3", sessionId: session, revision: revision() }),
        moveCommand("qg-fight-hero4-step3", "right", { actorId: "actor-4", sessionId: session, revision: revision() }),
      ]);
      submitWindow(engine, [
        playCardCommand("qg-fight-guard-ally", "hero-3-guard", "hero-4", "ranged", {
          actorId: "actor-3", sessionId: session, revision: revision(), cardRevision: cardRevision("hero-3"),
        }),
        moveCommand("qg-fight-hero4-contact", "right", { actorId: "actor-4", sessionId: session, revision: revision() }),
      ]);
      const hero4AfterApproach = engine.snapshot().entities.find((entity) => entity.id === "hero-4");
      const chaserAfterApproach = engine.snapshot().entities.find((entity) => entity.id === "enemy-chaser");
      expect({ heroMode: hero4AfterApproach?.mode, heroPosition: hero4AfterApproach?.position, chaserPosition: chaserAfterApproach?.position }).toEqual({
        heroMode: "movement", heroPosition: { x: 5, y: 6 }, chaserPosition: { x: 7, y: 5 },
      });
      submitWindow(engine, [
        playCardCommand("qg-fight-kill-extinguisher", "hero-3-card-1", "enemy-extinguisher", "ranged", {
          actorId: "actor-3", sessionId: session, revision: revision(), cardRevision: cardRevision("hero-3"),
        }),
        moveCommand("qg-fight-hero4-final-contact", "right", { actorId: "actor-4", sessionId: session, revision: revision() }),
      ]);
      const hero4InContact = engine.snapshot().entities.find((entity) => entity.id === "hero-4");
      expect(hero4InContact?.mode).toBe("melee");
      submitWindow(engine, [
        modeCommand("player.enter_movement_mode", "qg-fight-retreat", { actorId: "actor-4", sessionId: session, revision: revision() }),
      ]);
      submitWindow(engine, [
        playCardCommand("qg-fight-kill-chaser", "hero-1-card-1", "enemy-chaser", "ranged", {
          actorId: "actor-1", sessionId: session, revision: revision(), cardRevision: cardRevision("hero-1"),
        }),
      ]);

      const beforeOutcome = engine.events();
      expect(beforeOutcome.filter((event) => event.eventType === "scene.entity_removed")).toHaveLength(3);
      expect(beforeOutcome.some((event) => event.eventType === "scene.entity_moved")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "mode.changed")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "card.played")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "card.discarded" && event.payload.reason === "played")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "protection.triggered")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "stamina.changed" && event.payload.reason === "regeneration")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "status.applied" && event.payload.statusKey === "ally_guard")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "intent.resolved" && event.payload.enemyId === "enemy-extinguisher")).toBe(true);
      expect(beforeOutcome.some((event) => event.eventType === "hp.changed" && "source" in event.payload && event.payload.source.kind === "retreat_attack")).toBe(true);
      const outcome = run.confirmOutcome("success");
      expect(outcome).toMatchObject({ outcome: "success", rewardUnlocked: true, nodeState: "completed" });
      expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
      return {
        transcript: engine.events().map((event) => [event.eventType, event.serverTick]),
        finalStateHash: stateHashFromSnapshot(engine.snapshot()),
      };
    };
    expect(runGoldenFight()).toEqual(runGoldenFight());
  });

  it("selects Extinguisher intents in priority order and holds when no action is possible", () => {
    const chosen = (heroPosition: { x: number; y: number }, enemyPosition: { x: number; y: number }, terrain: SimulationEngineConfig["terrain"] = []) => {
      const engine = createSimulationEngine(testConfig({
        terrain,
        entities: [hero("hero-target", heroPosition.x, heroPosition.y), enemy("enemy-ext", enemyPosition.x, enemyPosition.y, "extinguisher")],
        initialIntentByEnemyId: {},
        heroIdByActorId: { "actor-target": "hero-target" },
      }));
      return engine.snapshot().activeIntents.find((intent) => intent.ownerEntityId === "enemy-ext")?.templateKey;
    };
    expect(chosen({ x: 5, y: 4 }, { x: 7, y: 4 })).toBe("bind");
    expect(chosen({ x: 1, y: 1 }, { x: 7, y: 7 })).toBe("move_close");
    expect(chosen({ x: 1, y: 1 }, { x: 7, y: 7 }, [
      { cell: { x: 6, y: 7 }, terrain: "wall" }, { cell: { x: 7, y: 6 }, terrain: "wall" },
      { cell: { x: 6, y: 6 }, terrain: "wall" },
    ])).toBe("hold_position");
  });

  it("manually confirms success only after enemies are gone and unlocks no items", () => {
    const run = campaign();
    const result = run.confirmOutcome("success");
    expect(result).toMatchObject({ outcome: "success", rewardUnlocked: true, nodeState: "completed", retryAllowed: false });
    expect(result.outcomeEvent.eventType).toBe("campaign.outcome_confirmed");
    expect(result.rollbackEvent.eventType).toBe("rollback.applied");
    expect(run.location).toBe("city");
    expect(run.engine.snapshot().outcome).toBeNull();
    expect(run.engine.events().filter((event) => event.eventType === "checkpoint.created")).toHaveLength(2);
    expect(stateHashFromSnapshot(run.engine.replayJournal())).toBe(stateHashFromSnapshot(run.engine.snapshot()));
  });

  it("rejects success with living enemies and defeat while any hero is still active", () => {
    const run = campaign(createQuarantineGatesEngine(2));
    expect(() => run.confirmOutcome("success")).toThrow(/every active enemy/);
    expect(() => run.confirmOutcome("defeat")).toThrow(/every hero/);
    expect(run.location).toBe("scene");
  });

  it("allows retreat at any time, restores the city save, keeps the node retryable and locks reward", () => {
    const run = campaign();
    const result = run.confirmOutcome("retreat");
    expect(result).toMatchObject({ outcome: "retreat", rewardUnlocked: false, nodeState: "open", retryAllowed: true });
    expect(run.location).toBe("city");
    expect(stateHashFromSnapshot(run.engine.replayJournal())).toBe(stateHashFromSnapshot(run.engine.snapshot()));

    run.enterRoute("avenrenn-road");
    run.enterNode("quarantine-gates");
    run.startScene();
    expect(run.location).toBe("scene");
    expect(run.engine.snapshot()).toMatchObject({ phase: "active", outcome: null, paused: false });
    expect(run.confirmOutcome("retreat")).toMatchObject({ outcome: "retreat", nodeState: "open", retryAllowed: true });
    expect(run.location).toBe("city");
  });

  it("requires all heroes critically injured for defeat and allows technical gm_abort without a reward", () => {
    const heroEntity = hero("hero-1", 1, 1);
    heroEntity.aliveState = "critically_injured";
    if (heroEntity.kind !== "hero") throw new Error("fixture error");
    heroEntity.hp.current = 0;
    const defeatRun = campaign(createSimulationEngine(testConfig({
      entities: [heroEntity, enemy("enemy-still-alive", 7, 7)],
      heroIdByActorId: { "actor-1": "hero-1" },
    })));
    const defeat = defeatRun.confirmOutcome("defeat");
    expect(defeat).toMatchObject({ outcome: "defeat", rewardUnlocked: false, nodeState: "closed", retryAllowed: true });
    expect(stateHashFromSnapshot(defeatRun.engine.replayJournal())).toBe(stateHashFromSnapshot(defeatRun.engine.snapshot()));

    const abortRun = campaign();
    const abort = abortRun.confirmOutcome("gm_abort");
    expect(abort).toMatchObject({ outcome: "gm_abort", rewardUnlocked: false, retryAllowed: true });
    expect(stateHashFromSnapshot(abortRun.engine.replayJournal())).toBe(stateHashFromSnapshot(abortRun.engine.snapshot()));
  });
});
