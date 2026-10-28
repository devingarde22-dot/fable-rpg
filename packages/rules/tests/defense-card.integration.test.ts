import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { enemy, hero, playCardCommand, testConfig } from "./createTestEngine.js";
import { testAllyGuardCard, testDamageBarrier, testPreventOneAttack } from "./fixtures/testCards.js";

function combatEngine(card: { instanceId: string; templateKey: string }) {
  return createSimulationEngine(testConfig({
    entities: [hero("hero-1", 1, 1, "movement", false, 3, { defenseSlot: card }), enemy("enemy-1", 2, 1)],
    initialIntentByEnemyId: { "enemy-1": "melee_strike" },
    heroIdByActorId: { "actor-1": "hero-1" },
  }));
}

function actor(engine: ReturnType<typeof createSimulationEngine>) {
  const entity = engine.snapshot().entities.find((item) => item.id === "hero-1");
  if (!entity || entity.kind !== "hero") throw new Error("Missing hero");
  return entity;
}

describe("test-only defense slot", () => {
  it.each([
    [testPreventOneAttack.key, "prevent_one_attack", 1000],
    [testDamageBarrier.key, "damage_barrier", 933],
  ])("plays %s for normal stamina cost and replays incoming protection", (templateKey, kind, expectedHp) => {
    const engine = combatEngine({ instanceId: "defense-1", templateKey });
    const currentHero = actor(engine);
    expect(currentHero.mode).toBe("melee");
    engine.submit(playCardCommand("defense-play", "defense-1", "hero-1", "melee", {
      revision: engine.snapshot().sceneRevision, cardRevision: currentHero.cards.revision,
    }));
    const played = engine.advanceTicks(5).at(-1);
    expect(played?.commandResults).toMatchObject([{ status: "accepted", requestId: "defense-play" }]);
    expect(played?.events.map((event) => event.eventType)).toEqual([
      "card.played", "stamina.changed", "card.effect_applied", "protection.applied", "card.discarded",
    ]);

    const attackEvents = engine.advanceTicks(115).at(-1)?.events ?? [];
    expect(attackEvents.map((event) => event.eventType)).toContain("protection.triggered");
    if (kind === "damage_barrier") expect(attackEvents.map((event) => event.eventType)).toContain("protection.expired");
    const finalHero = actor(engine);
    expect(finalHero.hp.current).toBe(expectedHp);
    expect(finalHero.protections).toHaveLength(0);
    expect(finalHero.stamina.current).toBe(2);
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
  });

  it("applies Ally Guard from the defense slot to an ally and replays the status", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-1", 1, 1, "ranged", false, 3, { defenseSlot: { instanceId: "guard-1", templateKey: testAllyGuardCard.key } }),
        hero("hero-2", 2, 1, "movement"), enemy("enemy-1", 7, 7),
      ],
      heroIdByActorId: { "actor-1": "hero-1", "actor-2": "hero-2" },
    }));
    const owner = actor(engine);
    engine.submit(playCardCommand("guard-play", "guard-1", "hero-2", "ranged", {
      revision: engine.snapshot().sceneRevision, cardRevision: owner.cards.revision,
    }));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.commandResults).toMatchObject([{ status: "accepted" }]);
    expect(engine.snapshot().entities.find((item) => item.id === "hero-2")?.statuses).toMatchObject([
      { templateKey: "ally_guard", potency: 20, sourceEntityId: "hero-1" },
    ]);
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
  });

  it("applies Ally Guard from the defense slot to self and replays the status", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-self", 1, 1, "ranged", false, 3, {
        defenseSlot: { instanceId: "guard-self", templateKey: testAllyGuardCard.key },
      })],
      heroIdByActorId: { "actor-self": "hero-self" },
    }));
    const self = engine.snapshot().entities.find((entity) => entity.id === "hero-self");
    if (!self || self.kind !== "hero") throw new Error("Missing self-target hero");
    engine.submit(playCardCommand("guard-self-play", "guard-self", "hero-self", "ranged", {
      actorId: "actor-self", revision: engine.snapshot().sceneRevision, cardRevision: self.cards.revision,
    }));
    const result = engine.advanceTicks(5).at(-1);
    expect(result?.commandResults).toMatchObject([{ status: "accepted" }]);
    expect(engine.snapshot().entities.find((entity) => entity.id === "hero-self")?.statuses).toMatchObject([
      { templateKey: "ally_guard", potency: 20, sourceEntityId: "hero-self" },
    ]);
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
  });

  it("expires an unspent barrier when the battle ends and replays the cleanup", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "ranged", false, 3, {
        defenseSlot: { instanceId: "barrier-end", templateKey: testDamageBarrier.key },
      })],
      heroIdByActorId: { "actor-1": "hero-1" },
    }));
    const currentHero = actor(engine);
    engine.submit(playCardCommand("barrier-end-play", "barrier-end", "hero-1", "ranged", {
      revision: engine.snapshot().sceneRevision, cardRevision: currentHero.cards.revision,
    }));
    engine.advanceTicks(5);
    expect(actor(engine).protections).toHaveLength(1);
    const result = engine.confirmOutcome("gm_abort");
    const heroAfterEnd = result.snapshot.entities.find((entity) => entity.id === "hero-1");
    expect(heroAfterEnd?.kind === "hero" ? heroAfterEnd.protections : []).toHaveLength(0);
    expect(engine.events()).toContainEqual(expect.objectContaining({
      eventType: "protection.expired",
      payload: expect.objectContaining({ heroId: "hero-1", kind: "damage_barrier", reason: "battle_ended" }),
    }));
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(engine.snapshot()));
  });
});
