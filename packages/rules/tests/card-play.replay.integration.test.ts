import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { replayEvents } from "../src/replay/replay.js";
import { stateHash, stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { enemy, hero, playCardCommand, testConfig } from "./createTestEngine.js";
import { testCostedRangedStrike, testFreeRangedStrike } from "./fixtures/testCards.js";

function makeConfig(cardInstances: readonly { instanceId: string; templateKey: string }[] = [
  { instanceId: "card-1", templateKey: testCostedRangedStrike.key },
]) {
  return testConfig({
    entities: [
      hero("hero-1", 1, 1, "ranged", false, 3, { hand: cardInstances.map((card) => ({ ...card })), discard: [], revision: 0 }),
      enemy("enemy-1", 3, 1),
    ],
    heroIdByActorId: { "actor-1": "hero-1" },
  });
}

function submitCurrentCard(engine: ReturnType<typeof createSimulationEngine>, requestId: string, cardInstanceId: string) {
  const snapshot = engine.snapshot();
  const actor = snapshot.entities.find((entity) => entity.id === "hero-1");
  if (!actor || actor.kind !== "hero") throw new Error("expected hero snapshot");
  engine.submit(playCardCommand(requestId, cardInstanceId, "enemy-1", "ranged", {
    revision: snapshot.sceneRevision,
    cardRevision: actor.cards.revision,
  }));
  return engine.advanceTicks(5).at(-1);
}

describe("player.play_card replay", () => {
  it("replays cost, timer reset, card damage source, discard, and state hash exactly", () => {
    const config = makeConfig();
    const initial = createRuntimeState(config);
    const engine = createSimulationEngine(config);
    const result = submitCurrentCard(engine, "play-1", "card-1");
    expect(result?.commandResults).toMatchObject([{ status: "accepted" }]);

    const live = engine.snapshot();
    const replayed = replayEvents(initial, engine.events());
    const journalReplayed = engine.replayJournal();
    expect(replayed).toEqual(live);
    expect(journalReplayed).toEqual(live);
    expect(stateHashFromSnapshot(replayed)).toBe(stateHash(engine.state as ReturnType<typeof createRuntimeState>));
    expect(stateHashFromSnapshot(journalReplayed)).toBe(stateHash(engine.state as ReturnType<typeof createRuntimeState>));
    expect(live.entities.find((entity) => entity.id === "hero-1")).toMatchObject({
      kind: "hero",
      stamina: { current: 2, nextRegenAtTick: 305 },
      cards: { hand: [], discard: [{ instanceId: "card-1", templateKey: testCostedRangedStrike.key }], revision: 1 },
    });
  });

  it("replays a zero-cost card at zero stamina without a card-cost event", () => {
    const config = makeConfig([
      { instanceId: "cost-1", templateKey: testCostedRangedStrike.key },
      { instanceId: "cost-2", templateKey: testCostedRangedStrike.key },
      { instanceId: "cost-3", templateKey: testCostedRangedStrike.key },
      { instanceId: "free-1", templateKey: testFreeRangedStrike.key },
    ]);
    const initial = createRuntimeState(config);
    const engine = createSimulationEngine(config);
    for (let index = 0; index < 3; index += 1) {
      submitCurrentCard(engine, `cost-play-${index + 1}`, `cost-${index + 1}`);
    }
    const freeResult = submitCurrentCard(engine, "free-play", "free-1");
    expect(freeResult?.events.map((event) => event.eventType)).toEqual(["card.played", "hp.changed", "card.discarded"]);
    expect(freeResult?.events.some((event) => event.eventType === "stamina.changed" && event.payload.reason === "card_cost")).toBe(false);

    const live = engine.snapshot();
    expect(replayEvents(initial, engine.events())).toEqual(live);
    expect(engine.replayJournal()).toEqual(live);
    expect(live.entities.find((entity) => entity.id === "hero-1")).toMatchObject({
      kind: "hero",
      stamina: { current: 0, nextRegenAtTick: 315 },
    });
  });

  it("rejects altered costs, missing cost/discard events, and mismatched damage sources", () => {
    const config = makeConfig();
    const engine = createSimulationEngine(config);
    submitCurrentCard(engine, "play-1", "card-1");
    const events = engine.events();
    const initial = createRuntimeState(config);

    const alteredCost = structuredClone(events);
    const played = alteredCost.find((event) => event.eventType === "card.played");
    if (!played || played.eventType !== "card.played") throw new Error("expected card.played event");
    played.payload.staminaCost += 1;
    expect(() => replayEvents(initial, alteredCost)).toThrow(/invalid hero, card, mode, cost, or target/);

    const withoutCost = events.filter((event) => !(event.eventType === "stamina.changed" && event.payload.reason === "card_cost"));
    expect(() => replayEvents(initial, withoutCost)).toThrow(/consecutive|event sequence is incomplete/);

    const alteredSource = structuredClone(events);
    const damage = alteredSource.find((event) => event.eventType === "hp.changed" && event.eventVersion === 2);
    if (!damage || damage.eventType !== "hp.changed" || damage.eventVersion !== 2 || damage.payload.source.kind !== "card") {
      throw new Error("expected card hp.changed event");
    }
    damage.payload.source.cardTemplateKey = "unknown-template";
    expect(() => replayEvents(initial, alteredSource)).toThrow(/card damage source/);

    const withoutDiscard = events.filter((event) => event.eventType !== "card.discarded");
    expect(() => replayEvents(initial, withoutDiscard)).toThrow(/consecutive|event sequence is incomplete|transaction completed/);

    const alteredDiscard = structuredClone(events);
    const discarded = alteredDiscard.find((event) => event.eventType === "card.discarded");
    if (!discarded || discarded.eventType !== "card.discarded") throw new Error("expected card.discarded event");
    discarded.payload.discardRevision += 1;
    expect(() => replayEvents(initial, alteredDiscard)).toThrow(/card.discarded/);
  });
});
