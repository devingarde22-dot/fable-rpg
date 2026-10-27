import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import type { StatusLayer } from "../src/engine/types.js";
import { enemy, hero, modeCommand, playCardCommand, testConfig } from "./createTestEngine.js";

describe("Ally Guard integration", () => {
  it("activates the existing Extinguisher ally_guard intent and protects its lowest-HP eligible ally", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-guard", 1, 1),
        enemy("enemy-extinguisher", 4, 4, "extinguisher"),
        enemy("enemy-ally", 5, 4, "slag_shooter"),
      ],
      heroIdByActorId: { "actor-1": "hero-guard" },
      initialIntentByEnemyId: { "enemy-extinguisher": "ally_guard" },
    }));

    const targetSelection = engine.events().find((event) => event.eventType === "intent.target_selected");
    expect(targetSelection?.eventType === "intent.target_selected" ? targetSelection.payload : undefined).toMatchObject({
      targetEntityId: "enemy-ally",
      selectionPolicy: "lowest_ally_hp_percentage",
      tieBreak: "single_candidate",
    });

    const resolution = engine.advanceTicks(300).at(-1);
    const guardEventIndex = resolution?.events.findIndex((event) => event.eventType === "status.applied") ?? -1;
    const resolvedIndex = resolution?.events.findIndex((event) => event.eventType === "intent.resolved") ?? -1;
    expect(resolvedIndex).toBeGreaterThanOrEqual(0);
    expect(guardEventIndex).toBeGreaterThan(resolvedIndex);
    const applied = resolution?.events[guardEventIndex];
    if (!applied || applied.eventType !== "status.applied") throw new Error("expected ally_guard status.applied");
    expect(applied).toMatchObject({
      actorId: "enemy-extinguisher",
      serverTick: 300,
      payload: {
        entityId: "enemy-ally",
        statusKey: "ally_guard",
        publicPotency: 20,
        timer: { startedAtTick: 300, resolvesAtTick: 600, durationMs: 15_000, remainingMs: 15_000, paused: false },
      },
    });
    expect(engine.snapshot().entities.find((entity) => entity.id === "enemy-ally")).toMatchObject({
      defense: 12,
      statuses: [{
        templateKey: "ally_guard",
        sourceEntityId: "enemy-extinguisher",
        potency: 20,
        stacks: 1,
        appliedAtTick: 300,
        expiresAtTick: 600,
        refreshPolicy: "refresh_duration",
      }],
    });
  });

  it("uses fractional effective defense in hp.changed and returns to base defense after expiry", () => {
    const guard: StatusLayer = {
      id: "status:enemy-ally:ally_guard:enemy-extinguisher:preloaded",
      templateKey: "ally_guard",
      sourceEntityId: "enemy-extinguisher",
      potency: 20,
      stacks: 1,
      appliedAtTick: 0,
      expiresAtTick: 10,
      refreshPolicy: "refresh_duration",
    };
    const engine = createSimulationEngine(testConfig({
      entities: [
        hero("hero-attacker", 1, 1, "movement", true, 3, {
          drawPile: [
            { instanceId: "attack-with-guard-active", templateKey: "test-only-ranged-strike" },
            { instanceId: "attack-after-guard-expiry", templateKey: "test-only-ranged-strike" },
          ],
        }),
        enemy("enemy-extinguisher", 6, 4, "extinguisher"),
        { ...enemy("enemy-ally", 5, 4, "slag_shooter"), statuses: [guard] },
      ],
      heroIdByActorId: { "actor-1": "hero-attacker" },
      initialIntentByEnemyId: {},
    }));
    const beforeMode = engine.snapshot().entities.find((entity) => entity.id === "hero-attacker");
    if (!beforeMode || beforeMode.kind !== "hero") throw new Error("expected movement-mode attacker snapshot");
    expect(beforeMode.cards.drawPile.map((card) => card.instanceId)).toEqual([
      "attack-with-guard-active",
      "attack-after-guard-expiry",
    ]);

    engine.submit(modeCommand("player.enter_ranged_mode", "enter-ranged", {
      actorId: "actor-1",
      revision: engine.snapshot().sceneRevision,
    }));
    const modeWindow = engine.advanceTicks(5).at(-1);
    expect(modeWindow?.commandResults).toMatchObject([{ requestId: "enter-ranged", status: "accepted" }]);
    expect(modeWindow?.events.map((event) => event.eventType)).toEqual([
      "mode.changed", "deck.shuffled", "card.drawn", "card.drawn",
    ]);
    const initialHero = engine.snapshot().entities.find((entity) => entity.id === "hero-attacker");
    if (!initialHero || initialHero.kind !== "hero") throw new Error("expected ranged attacker snapshot");
    expect(initialHero.cards.hand.map((card) => card.instanceId)).toEqual(expect.arrayContaining([
      "attack-with-guard-active",
      "attack-after-guard-expiry",
    ]));

    engine.submit(playCardCommand("guarded-hit", "attack-with-guard-active", "enemy-ally", "ranged", {
      actorId: "actor-1",
      revision: engine.snapshot().sceneRevision,
      cardRevision: initialHero.cards.revision,
      targetCell: { x: 5, y: 4 },
    }));
    const firstWindow = engine.advanceTicks(5).at(-1);
    expect(firstWindow?.commandResults).toMatchObject([{ requestId: "guarded-hit", status: "accepted" }]);
    const guardedDamage = firstWindow?.events.find((event) => event.eventType === "hp.changed");
    if (!guardedDamage || guardedDamage.eventType !== "hp.changed" || guardedDamage.eventVersion !== 2) {
      throw new Error("expected guarded hp.changed v2");
    }
    expect(guardedDamage.payload).toMatchObject({ defense: 12 * 1.2, rawDamage: 37, finalDamage: 33 });
    expect(firstWindow?.events.some((event) => event.eventType === "status.expired")).toBe(true);
    expect(engine.snapshot().entities.find((entity) => entity.id === "enemy-ally")?.defense).toBe(12);

    const currentHero = engine.snapshot().entities.find((entity) => entity.id === "hero-attacker");
    if (!currentHero || currentHero.kind !== "hero") throw new Error("expected attacker snapshot");
    engine.submit(playCardCommand("unguarded-hit", "attack-after-guard-expiry", "enemy-ally", "ranged", {
      actorId: "actor-1",
      revision: engine.snapshot().sceneRevision,
      cardRevision: currentHero.cards.revision,
      targetCell: { x: 5, y: 4 },
    }));
    const secondWindow = engine.advanceTicks(5).at(-1);
    expect(secondWindow?.commandResults).toMatchObject([{ requestId: "unguarded-hit", status: "accepted" }]);
    const baseDamage = secondWindow?.events.find((event) => event.eventType === "hp.changed");
    if (!baseDamage || baseDamage.eventType !== "hp.changed" || baseDamage.eventVersion !== 2) {
      throw new Error("expected unguarded hp.changed v2");
    }
    expect(baseDamage.payload).toMatchObject({ defense: 12, rawDamage: 37, finalDamage: 34 });

    const live = engine.snapshot();
    expect(engine.replay(engine.events())).toEqual(live);
    expect(engine.replayJournal()).toEqual(live);
    expect(stateHashFromSnapshot(engine.replay(engine.events()))).toBe(stateHashFromSnapshot(live));
  });
});
