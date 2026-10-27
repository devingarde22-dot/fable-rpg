import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, modeCommand, testConfig } from "./createTestEngine.js";
import { testCostedRangedStrike, testFreeMeleeStrike, testModeNeutralStrike } from "./fixtures/testCards.js";

const ranged = (n: number) => ({ instanceId: `ranged-${n}`, templateKey: testCostedRangedStrike.key });
const melee = (n: number) => ({ instanceId: `melee-${n}`, templateKey: testFreeMeleeStrike.key });
const neutral = (n: number) => ({ instanceId: `neutral-${n}`, templateKey: testModeNeutralStrike.key });
const heroById = (engine: ReturnType<typeof createSimulationEngine>) =>
  engine.snapshot().entities.find((entity) => entity.id === "hero-1");

function enterRanged(engine: ReturnType<typeof createSimulationEngine>) {
  expect(engine.submit(modeCommand("player.enter_ranged_mode", "enter-ranged")).status).toBe("queued");
  return engine.advanceTicks(5).at(-1);
}

describe("mode-filtered deck lifecycle", () => {
  it("rebuilds the eligible pile from every container, excludes wrong-mode cards, deals up to five, and anchors the timer at entry tick", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", true, 3, {
        drawPile: [ranged(1), melee(1), neutral(1)],
        hand: [melee(2)],
        discard: [ranged(2)],
        excludedForMode: [ranged(3)],
        revision: 4,
      }), enemy("enemy-1", 7, 7)],
    }));

    const result = enterRanged(engine);
    expect(result?.serverTick).toBe(5);
    expect(result?.events.map((event) => event.eventType)).toEqual([
      "mode.changed", "deck.shuffled", "card.drawn", "card.drawn", "card.drawn", "card.drawn",
    ]);
    const shuffle = result?.events.find((event) => event.eventType === "deck.shuffled");
    if (!shuffle || shuffle.eventType !== "deck.shuffled") throw new Error("expected mode-entry shuffle");
    expect(shuffle.payload.sourceCardInstanceIds).toEqual([
      "melee-1", "melee-2", "neutral-1", "ranged-1", "ranged-2", "ranged-3",
    ]);
    expect(shuffle.payload.eligibleCardInstanceIds).toEqual(["neutral-1", "ranged-1", "ranged-2", "ranged-3"]);
    expect(shuffle.payload.excludedCardInstanceIds).toEqual(["melee-1", "melee-2"]);
    const heroState = heroById(engine);
    if (!heroState || heroState.kind !== "hero") throw new Error("expected hero runtime");
    expect(heroState).toMatchObject({
      kind: "hero",
      mode: "ranged",
      cards: {
        hand: expect.arrayContaining([ranged(1), ranged(2), ranged(3), neutral(1)]),
        drawPile: [],
        discard: [],
        excludedForMode: expect.arrayContaining([melee(1), melee(2)]),
        nextHandRotationAtTick: 305,
      },
    });
    expect(result?.events.filter((event) => event.eventType === "card.drawn").map((event) => event.payload.cardInstanceId))
      .toEqual([...heroState.cards.hand].reverse().map((card) => card.instanceId));
  });

  it("rotates a full hand right-to-left, draws left, and reshuffles discard only after drawPile empties", () => {
    const cards = Array.from({ length: 6 }, (_, index) => ranged(index + 1));
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", true, 3, { drawPile: cards }), enemy("enemy-1", 7, 7)],
    }));
    enterRanged(engine);

    let heroState = heroById(engine);
    if (!heroState || heroState.kind !== "hero") throw new Error("expected hero runtime");
    const firstRightmost = heroState.cards.hand.at(-1)?.instanceId;
    const firstDraw = heroState.cards.drawPile[0]?.instanceId;
    expect(heroState.cards.hand).toHaveLength(5);
    expect(heroState.cards.drawPile).toHaveLength(1);

    const beforeDue = engine.advanceTicks(299).at(-1);
    expect(beforeDue?.serverTick).toBe(304);
    expect(beforeDue?.events).toEqual([]);
    const firstRotation = engine.advanceTicks(1).at(-1);
    expect(firstRotation?.serverTick).toBe(305);
    expect(firstRotation?.events.map((event) => event.eventType)).toEqual([
      "card.discarded", "card.drawn", "deck.rotation_resolved",
    ]);
    heroState = heroById(engine);
    expect(heroState).toMatchObject({ kind: "hero", cards: { nextHandRotationAtTick: 605 } });
    if (!heroState || heroState.kind !== "hero") throw new Error("expected hero runtime");
    expect(heroState.cards.hand[0]?.instanceId).toBe(firstDraw);
    expect(heroState.cards.discard.map((card) => card.instanceId)).toEqual([firstRightmost]);
    expect(firstRotation?.events.at(-1)).toMatchObject({
      eventType: "deck.rotation_resolved",
      payload: { dueAtTick: 305, nextHandRotationAtTick: 605, discardedCardInstanceId: firstRightmost, drawnCardInstanceId: firstDraw },
    });

    const secondRotation = engine.advanceTicks(300).at(-1);
    expect(secondRotation?.serverTick).toBe(605);
    expect(secondRotation?.events.map((event) => event.eventType)).toEqual([
      "card.discarded", "deck.shuffled", "card.drawn", "deck.rotation_resolved",
    ]);
    const secondShuffle = secondRotation?.events.find((event) => event.eventType === "deck.shuffled");
    if (!secondShuffle || secondShuffle.eventType !== "deck.shuffled") throw new Error("expected discard reshuffle");
    expect(secondShuffle.payload.reason).toBe("discard_exhausted");
    expect(secondShuffle.payload.sourceCardInstanceIds).toHaveLength(2);
    heroState = heroById(engine);
    expect(heroState).toMatchObject({ kind: "hero", cards: { nextHandRotationAtTick: 905 } });
  });

  it("records a no-card rotation without changing hand when every eligible pile is empty", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", true, 3, { drawPile: [ranged(1)] }), enemy("enemy-1", 7, 7)],
    }));
    enterRanged(engine);
    const before = heroById(engine);
    if (!before || before.kind !== "hero") throw new Error("expected hero runtime");
    expect(before.cards.hand.map((card) => card.instanceId)).toEqual(["ranged-1"]);

    const rotation = engine.advanceTicks(300).at(-1);
    expect(rotation?.serverTick).toBe(305);
    expect(rotation?.events.map((event) => event.eventType)).toEqual(["deck.rotation_resolved"]);
    expect(rotation?.events[0]).toMatchObject({
      eventType: "deck.rotation_resolved",
      payload: { dueAtTick: 305, nextHandRotationAtTick: 605, discardedCardInstanceId: null, drawnCardInstanceId: null },
    });
    expect(heroById(engine)).toMatchObject({ kind: "hero", cards: { hand: [{ instanceId: "ranged-1" }], nextHandRotationAtTick: 605 } });
  });

  it("does not rotate cards for a non-active hero even when its stored mode is combat", () => {
    const downed = hero("hero-1", 1, 1, "ranged", true, 3, { drawPile: [ranged(1)] });
    if (downed.kind !== "hero") throw new Error("expected hero fixture");
    downed.aliveState = "critically_injured";
    downed.hp.current = 0;
    const engine = createSimulationEngine(testConfig({
      entities: [downed, enemy("enemy-1", 7, 7)],
      heroIdByActorId: {},
    }));
    engine.advanceTicks(300);
    expect(engine.events().filter((event) => event.eventType === "deck.rotation_resolved")).toEqual([]);
    expect(heroById(engine)).toMatchObject({ kind: "hero", cards: { nextHandRotationAtTick: null, drawPile: [{ instanceId: "ranged-1" }] } });
  });

  it("re-filters and re-deals on direct melee-to-ranged transition without resetting the combat timer", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "melee", true, 3, {
        drawPile: [ranged(1), melee(1)],
        hand: [melee(2)],
        discard: [ranged(2)],
      }), enemy("enemy-1", 7, 7)],
    }));
    expect(heroById(engine)).toMatchObject({ kind: "hero", cards: { nextHandRotationAtTick: 300 } });

    engine.submit(modeCommand("player.enter_ranged_mode", "switch-ranged"));
    const switched = engine.advanceTicks(5).at(-1);
    expect(switched?.events.map((event) => event.eventType)).toEqual([
      "mode.changed", "deck.shuffled", "card.drawn", "card.drawn",
    ]);
    expect(switched?.events[0]).toMatchObject({ eventType: "mode.changed", payload: { from: "melee", to: "ranged" } });
    expect(heroById(engine)).toMatchObject({
      kind: "hero",
      mode: "ranged",
      cards: {
        hand: expect.arrayContaining([ranged(1), ranged(2)]),
        excludedForMode: expect.arrayContaining([melee(1), melee(2)]),
        nextHandRotationAtTick: 300,
      },
    });
  });

  it("starts a fresh full interval only after movement exit and combat re-entry", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", true, 3, {
        drawPile: [ranged(1), melee(1), ranged(2), melee(2)],
      }), enemy("enemy-1", 7, 7)],
    }));
    enterRanged(engine);
    expect(heroById(engine)).toMatchObject({ kind: "hero", cards: { nextHandRotationAtTick: 305 } });

    engine.submit(modeCommand("player.enter_movement_mode", "exit-ranged", { revision: 1 }));
    const exitResult = engine.advanceTicks(5).at(-1);
    expect(exitResult?.events.map((event) => event.eventType)).toEqual(["mode.changed"]);
    expect(heroById(engine)).toMatchObject({ kind: "hero", mode: "movement", cards: { nextHandRotationAtTick: null } });

    engine.submit(modeCommand("player.enter_ranged_mode", "reenter-ranged", { revision: 2 }));
    engine.advanceTicks(5);
    expect(heroById(engine)).toMatchObject({ kind: "hero", cards: { nextHandRotationAtTick: 315 } });
  });
});
