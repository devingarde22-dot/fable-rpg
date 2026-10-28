import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, gameplayState, hero, playCardCommand, testConfig, testIntentTemplates } from "./createTestEngine.js";
import { testCostedRangedStrike, testFreeRangedStrike } from "./fixtures/testCards.js";

function makeEngine(options: {
  heroMode?: "movement" | "melee" | "ranged" | null;
  maxStamina?: number;
  targetX?: number;
  terrain?: readonly { cell: { x: number; y: number }; terrain: "floor" | "wall" | "statue" }[];
  hand?: readonly { instanceId: string; templateKey: string }[];
} = {}) {
  return createSimulationEngine(testConfig({
    ...(options.terrain === undefined ? {} : { terrain: options.terrain }),
    entities: [
      hero("hero-1", 1, 1, options.heroMode ?? "ranged", false, options.maxStamina ?? 3, {
        hand: (options.hand ?? [{ instanceId: "card-1", templateKey: testCostedRangedStrike.key }]).map((card) => ({ ...card })),
        discard: [],
        revision: 0,
      }),
      enemy("enemy-1", options.targetX ?? 3, 1),
    ],
    heroIdByActorId: { "actor-1": "hero-1" },
  }));
}

function currentRevisions(engine: ReturnType<typeof createSimulationEngine>) {
  const snapshot = engine.snapshot();
  const actor = snapshot.entities.find((entity) => entity.id === "hero-1");
  if (!actor || actor.kind !== "hero") throw new Error("expected hero snapshot");
  return { scene: snapshot.sceneRevision, cards: actor.cards.revision };
}

describe("player.play_card integration", () => {
  it("plays one hand card, pays stamina, deals direct damage, and discards in canonical event order", () => {
    const engine = makeEngine();
    const revisions = currentRevisions(engine);
    expect(engine.submit(playCardCommand("play-1", "card-1", "enemy-1", "ranged", {
      revision: revisions.scene,
      cardRevision: revisions.cards,
    }))).toMatchObject({ status: "queued" });

    const result = engine.advanceTicks(5).at(-1);
    expect(result?.commandResults).toMatchObject([{ requestId: "play-1", status: "accepted", sceneRevision: 1 }]);
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "card.played",
      "stamina.changed",
      "hp.changed",
      "card.discarded",
    ]);
    expect(result?.sceneRevision).toBe(1);
    const snapshot = engine.snapshot();
    const actor = snapshot.entities.find((entity) => entity.id === "hero-1");
    const target = snapshot.entities.find((entity) => entity.id === "enemy-1");
    expect(actor).toMatchObject({
      kind: "hero",
      stamina: { current: 2, max: 3, nextRegenAtTick: 305 },
      cards: { hand: [], discard: [{ instanceId: "card-1", templateKey: testCostedRangedStrike.key }], revision: 1 },
    });
    expect(target?.hp.current).toBe(869);
    const damage = result?.events.find((event) => event.eventType === "hp.changed");
    expect(damage).toMatchObject({
      eventType: "hp.changed",
      eventVersion: 2,
      actorId: "actor-1",
      payload: {
        kind: "damage",
        source: { kind: "card", heroId: "hero-1", cardInstanceId: "card-1", cardTemplateKey: testCostedRangedStrike.key },
        formulaVersion: "fable.damage.v1",
        rawDamage: 37,
        finalDamage: 31,
      },
    });
    expect(result?.events.at(-1)).toMatchObject({
      eventType: "card.discarded",
      payload: { heroId: "hero-1", cardInstanceId: "card-1", reason: "played", discardRevision: 1 },
    });
  });

  it("rejects positive cost at zero stamina without card mutation, and allows cost=0 at zero", () => {
    const engine = makeEngine({ hand: [
      { instanceId: "cost-1", templateKey: testCostedRangedStrike.key },
      { instanceId: "cost-2", templateKey: testCostedRangedStrike.key },
      { instanceId: "cost-3", templateKey: testCostedRangedStrike.key },
      { instanceId: "cost-4", templateKey: testCostedRangedStrike.key },
      { instanceId: "free-1", templateKey: testFreeRangedStrike.key },
    ] });

    for (let index = 0; index < 3; index += 1) {
      const revisions = currentRevisions(engine);
      const requestId = `cost-${index + 1}-play`;
      engine.submit(playCardCommand(requestId, `cost-${index + 1}`, "enemy-1", "ranged", {
        revision: revisions.scene,
        cardRevision: revisions.cards,
        sequence: index + 1,
      }));
      expect(engine.advanceTicks(5).at(-1)?.commandResults).toMatchObject([{ requestId, status: "accepted" }]);
    }

    const beforeInsufficient = engine.snapshot();
    expect(beforeInsufficient.entities.find((entity) => entity.id === "hero-1")).toMatchObject({
      kind: "hero",
      stamina: { current: 0, nextRegenAtTick: 315 },
      cards: { revision: 3, hand: [
        { instanceId: "cost-4", templateKey: testCostedRangedStrike.key },
        { instanceId: "free-1", templateKey: testFreeRangedStrike.key },
      ] },
    });
    const beforeRejectedGameplay = gameplayState(beforeInsufficient);
    const revisions = currentRevisions(engine);
    engine.submit(playCardCommand("insufficient", "cost-4", "enemy-1", "ranged", {
      revision: revisions.scene,
      cardRevision: revisions.cards,
    }));
    const rejected = engine.advanceTicks(5).at(-1);
    expect(rejected?.commandResults).toMatchObject([{ requestId: "insufficient", status: "rejected", code: "INSUFFICIENT_STAMINA" }]);
    expect(gameplayState(engine.snapshot())).toEqual(beforeRejectedGameplay);
    expect(rejected?.events).toEqual([]);

    const freeRevisions = currentRevisions(engine);
    engine.submit(playCardCommand("free-at-zero", "free-1", "enemy-1", "ranged", {
      revision: freeRevisions.scene,
      cardRevision: freeRevisions.cards,
    }));
    const freeResult = engine.advanceTicks(5).at(-1);
    expect(freeResult?.commandResults).toMatchObject([{ requestId: "free-at-zero", status: "accepted" }]);
    expect(freeResult?.events.map((event) => event.eventType)).toEqual(["card.played", "hp.changed", "card.discarded"]);
    const afterFree = engine.snapshot().entities.find((entity) => entity.id === "hero-1");
    expect(afterFree).toMatchObject({ kind: "hero", stamina: { current: 0, nextRegenAtTick: 315 } });
  });

  it("restarts a pending regeneration timer when a positive cost is paid on its old due tick", () => {
    const engine = makeEngine({ maxStamina: 5 });
    engine.advanceTicks(295);
    const revisions = currentRevisions(engine);
    engine.submit(playCardCommand("play-at-due", "card-1", "enemy-1", "ranged", {
      revision: revisions.scene,
      cardRevision: revisions.cards,
    }));
    const result = engine.advanceTicks(5).at(-1);

    expect(result?.serverTick).toBe(300);
    expect(result?.commandResults).toMatchObject([{ requestId: "play-at-due", status: "accepted" }]);
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "card.played",
      "stamina.changed",
      "hp.changed",
      "card.discarded",
      "deck.shuffled",
      "card.drawn",
      "deck.rotation_resolved",
    ]);
    expect(result?.events.filter((event) => event.eventType === "stamina.changed").map((event) => event.payload.reason))
      .toEqual(["card_cost"]);
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-1")).toMatchObject({
      kind: "hero",
      stamina: { current: 2, max: 5, nextRegenAtTick: 600 },
    });
  });

  it("ignores a stale scene cursor at card apply but strictly checks clientCardRevision", () => {
    const shortHoldTemplates = testIntentTemplates.map((template) =>
      template.key === "hold_position" ? { ...template, durationMs: 3_050 } : template,
    );
    const staleScene = createSimulationEngine(testConfig({
      entities: [
        hero("hero-1", 1, 1, "ranged", false, 3, { hand: [{ instanceId: "card-1", templateKey: testCostedRangedStrike.key }], discard: [], revision: 0 }),
        enemy("enemy-1", 3, 1),
      ],
      initialIntentByEnemyId: { "enemy-1": "hold_position" },
      intentTemplates: shortHoldTemplates,
    }));
    staleScene.advanceTicks(62);
    const now = currentRevisions(staleScene);
    expect(now.scene).toBeGreaterThan(0);
    expect(staleScene.submit(playCardCommand("stale-scene-card", "card-1", "enemy-1", "ranged", {
      revision: 0, cardRevision: now.cards,
    }))).toMatchObject({ status: "queued" });
    const applied = staleScene.advanceTicks(3).at(-1);
    expect(applied?.commandResults).toMatchObject([{ requestId: "stale-scene-card", status: "accepted" }]);

    const staleCard = makeEngine();
    const before = gameplayState(staleCard.snapshot());
    const revisions = currentRevisions(staleCard);
    staleCard.submit(playCardCommand("stale-card-only", "card-1", "enemy-1", "ranged", {
      revision: revisions.scene + 99, cardRevision: revisions.cards + 1,
    }));
    const rejected = staleCard.advanceTicks(5).at(-1);
    expect(rejected?.commandResults).toMatchObject([{ status: "rejected", code: "STALE_CARD_REVISION" }]);
    expect(rejected?.events).toEqual([]);
    expect(gameplayState(staleCard.snapshot())).toEqual(before);
  });

  it("rejects a stale card revision without mutation and does not double-play a duplicate requestId", () => {
    const staleEngine = makeEngine();
    const before = gameplayState(staleEngine.snapshot());
    const revisions = currentRevisions(staleEngine);
    staleEngine.submit(playCardCommand("stale-card-revision", "card-1", "enemy-1", "ranged", {
      revision: revisions.scene,
      cardRevision: revisions.cards + 1,
    }));
    const staleResult = staleEngine.advanceTicks(5).at(-1);
    expect(staleResult?.commandResults).toMatchObject([{
      requestId: "stale-card-revision",
      status: "rejected",
      code: "STALE_CARD_REVISION",
    }]);
    expect(staleResult?.events).toEqual([]);
    expect(gameplayState(staleEngine.snapshot())).toEqual(before);

    const duplicateEngine = makeEngine();
    const duplicateRevision = currentRevisions(duplicateEngine);
    const command = playCardCommand("same-request", "card-1", "enemy-1", "ranged", {
      revision: duplicateRevision.scene,
      cardRevision: duplicateRevision.cards,
    });
    const firstSubmit = duplicateEngine.submit(command);
    expect(firstSubmit).toMatchObject({ status: "queued" });
    expect(duplicateEngine.submit(command)).toEqual({
      status: "duplicate",
      requestId: "same-request",
      original: firstSubmit,
    });
    const duplicateTick = duplicateEngine.advanceTicks(5).at(-1);
    expect(duplicateTick?.commandResults).toMatchObject([{ requestId: "same-request", status: "accepted" }]);
    expect(duplicateTick?.events.map((event) => event.eventType)).toEqual([
      "card.played",
      "stamina.changed",
      "hp.changed",
      "card.discarded",
    ]);
    expect(duplicateTick?.events.filter((event) => event.eventType === "card.played")).toHaveLength(1);
  });

  it.each([
    ["mode mismatch", { heroMode: "melee" as const }, "ranged" as const, "enemy-1", "CARD_MODE_MISMATCH"],
    ["missing entity target", {}, "ranged" as const, undefined, "TARGET_NOT_VISIBLE"],
    ["out-of-range target", { targetX: 7 }, "ranged" as const, "enemy-1", "TARGET_OUT_OF_RANGE"],
    ["blocked line of sight", { terrain: [{ cell: { x: 2, y: 1 }, terrain: "wall" as const }] }, "ranged" as const, "enemy-1", "LINE_OF_SIGHT_BLOCKED"],
  ])("rejects %s before any gameplay mutation", (_label, options, mode, targetEntityId, expectedCode) => {
    const engine = makeEngine(options);
    const before = gameplayState(engine.snapshot());
    const revisions = currentRevisions(engine);
    engine.submit(playCardCommand("reject-play", "card-1", targetEntityId, mode, {
      revision: revisions.scene,
      cardRevision: revisions.cards,
    }));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.commandResults).toMatchObject([{ requestId: "reject-play", status: "rejected", code: expectedCode }]);
    expect(result?.events).toEqual([]);
    expect(gameplayState(engine.snapshot())).toEqual(before);
  });
});
