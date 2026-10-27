import { describe, expect, it } from "vitest";
import { resolvePlayCard } from "../src/cards/playCard.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { stateHash } from "../src/replay/stateHash.js";
import { enemy, hero, playCardCommand, testConfig } from "./createTestEngine.js";
import { testCostedRangedStrike, testFreeRangedStrike } from "./fixtures/testCards.js";

function createCardState(options: {
  cardKey?: string;
  heroMode?: "movement" | "melee" | "ranged" | null;
  targetX?: number;
  terrain?: readonly { cell: { x: number; y: number }; terrain: "floor" | "wall" | "statue" }[];
} = {}) {
  const cardKey = options.cardKey ?? testCostedRangedStrike.key;
  return createRuntimeState(testConfig({
    ...(options.terrain === undefined ? {} : { terrain: options.terrain }),
    entities: [
      hero("hero-1", 1, 1, options.heroMode ?? "ranged", false, 3, {
        hand: [{ instanceId: "card-1", templateKey: cardKey }],
        discard: [],
        revision: 0,
      }),
      enemy("enemy-1", options.targetX ?? 3, 1),
    ],
    heroIdByActorId: { "actor-1": "hero-1" },
  }));
}

describe("player.play_card unit rules", () => {
  it("resolves a TEST_ONLY / NON_BALANCE direct-damage fixture and emits ordered events", () => {
    const state = createCardState();
    const result = resolvePlayCard(state, playCardCommand("play-1", "card-1", "enemy-1", "ranged"));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected card play to succeed");
    expect(result.pendingEvents.map(({ event }) => event.eventType)).toEqual([
      "card.played",
      "stamina.changed",
      "hp.changed",
      "card.discarded",
    ]);
    const heroState = state.entities.get("hero-1");
    const target = state.entities.get("enemy-1");
    expect(heroState).toMatchObject({
      kind: "hero",
      stamina: { current: 2, max: 3, nextRegenAtTick: 300 },
      cards: { hand: [], discard: [{ instanceId: "card-1", templateKey: testCostedRangedStrike.key }], revision: 1 },
    });
    expect(target?.hp.current).toBe(869);
    expect(testCostedRangedStrike.fixtureClassification).toBe("TEST_ONLY / NON_BALANCE");
  });

  it("allows a zero-cost fixture with zero stamina and emits no cost event", () => {
    const state = createCardState({ cardKey: testFreeRangedStrike.key });
    const runtimeHero = state.entities.get("hero-1");
    if (!runtimeHero || runtimeHero.kind !== "hero") throw new Error("expected hero");
    runtimeHero.stamina.current = 0;
    runtimeHero.stamina.nextRegenAtTick = 300;
    const beforeTimer = runtimeHero.stamina.nextRegenAtTick;

    const result = resolvePlayCard(state, playCardCommand("free-1", "card-1", "enemy-1", "ranged"));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected free card play to succeed");
    expect(result.pendingEvents.map(({ event }) => event.eventType)).toEqual(["card.played", "hp.changed", "card.discarded"]);
    expect(runtimeHero.stamina).toMatchObject({ current: 0, nextRegenAtTick: beforeTimer });
  });

  it.each([
    ["wrong mode", { heroMode: "melee" as const }, "CARD_MODE_MISMATCH"],
    ["out of range", { targetX: 7 }, "TARGET_OUT_OF_RANGE"],
    ["blocked line of sight", { terrain: [{ cell: { x: 2, y: 1 }, terrain: "wall" as const }] }, "LINE_OF_SIGHT_BLOCKED"],
  ])("rejects %s without mutating runtime state", (_label, options, expectedCode) => {
    const state = createCardState(options);
    const beforeHash = stateHash(state);
    const result = resolvePlayCard(state, playCardCommand("invalid-play", "card-1", "enemy-1", "ranged"));

    expect(result).toEqual({ ok: false, code: expectedCode });
    expect(stateHash(state)).toBe(beforeHash);
  });

  it("rejects unaffordable cost, unavailable target, and unable hero without mutation", () => {
    const state = createCardState();
    const actor = state.entities.get("hero-1");
    const target = state.entities.get("enemy-1");
    if (!actor || actor.kind !== "hero" || !target) throw new Error("expected test entities");
    actor.stamina.current = 0;
    actor.stamina.nextRegenAtTick = 300;
    let beforeHash = stateHash(state);
    expect(resolvePlayCard(state, playCardCommand("poor", "card-1", "enemy-1", "ranged")))
      .toEqual({ ok: false, code: "INSUFFICIENT_STAMINA" });
    expect(stateHash(state)).toBe(beforeHash);

    target.hp.current = 0;
    beforeHash = stateHash(state);
    expect(resolvePlayCard(state, playCardCommand("dead-target", "card-1", "enemy-1", "ranged")))
      .toEqual({ ok: false, code: "TARGET_NOT_VISIBLE" });
    expect(stateHash(state)).toBe(beforeHash);

    actor.hp.current = 0;
    actor.aliveState = "critically_injured";
    actor.stamina.nextRegenAtTick = null;
    beforeHash = stateHash(state);
    expect(resolvePlayCard(state, playCardCommand("inactive-hero", "card-1", "enemy-1", "ranged")))
      .toEqual({ ok: false, code: "ENTITY_UNABLE_TO_ACT" });
    expect(stateHash(state)).toBe(beforeHash);
  });

  it("rejects a missing target and stale card revision", () => {
    const state = createCardState();
    expect(resolvePlayCard(state, playCardCommand("no-target", "card-1", undefined, "ranged")))
      .toEqual({ ok: false, code: "TARGET_NOT_VISIBLE" });
    expect(resolvePlayCard(state, playCardCommand("stale-card", "card-1", "enemy-1", "ranged", { cardRevision: 1 })))
      .toEqual({ ok: false, code: "STALE_CARD_REVISION" });
  });
});
