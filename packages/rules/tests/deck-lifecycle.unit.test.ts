import { describe, expect, it } from "vitest";
import { shuffleCardInstances } from "../src/cards/deckLifecycle.js";
import type { CardInstance } from "../src/engine/types.js";

const forkInput = {
  rootSeed: "increment-7-unit-seed",
  campaignId: "campaign-test",
  sceneId: "scene-test",
  serverTick: 300,
  activeIntentId: "deck:hero-1:ranged:mode_entry:1",
  purpose: "deck_shuffle" as const,
};

const sampleCards: CardInstance[] = [
  { instanceId: "card-a", templateKey: "fixture-a" },
  { instanceId: "card-b", templateKey: "fixture-b" },
  { instanceId: "card-c", templateKey: "fixture-c" },
  { instanceId: "card-d", templateKey: "fixture-d" },
];

describe("deck shuffle", () => {
  it("uses deterministic Fisher–Yates output and leaves source order untouched", () => {
    const sourceBefore = structuredClone(sampleCards);
    const first = shuffleCardInstances(sampleCards, forkInput);
    const second = shuffleCardInstances(sampleCards, forkInput);
    expect(first.cards).toEqual(second.cards);
    expect(first.audit).toEqual(second.audit);
    expect(first.cards.map((card) => card.instanceId).sort()).toEqual(sampleCards.map((card) => card.instanceId).sort());
    expect(sampleCards).toEqual(sourceBefore);
  });

  it("handles empty and singleton piles without losing card instances", () => {
    expect(shuffleCardInstances([], forkInput).cards).toEqual([]);
    expect(shuffleCardInstances([sampleCards[0]!], forkInput).cards).toEqual([sampleCards[0]]);
  });
});
