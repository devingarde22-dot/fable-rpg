import { describe, expect, it } from "vitest";
import { replayJournalRecords } from "../src/replay/replay.js";
import { stateHashFromSnapshot } from "../src/replay/stateHash.js";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { enemy, hero, modeCommand, testConfig } from "./createTestEngine.js";
import { testCostedRangedStrike, testFreeMeleeStrike } from "./fixtures/testCards.js";

const allCards = [
  ...Array.from({ length: 6 }, (_, index) => ({ instanceId: `ranged-${index + 1}`, templateKey: testCostedRangedStrike.key })),
  { instanceId: "melee-1", templateKey: testFreeMeleeStrike.key },
];

function makeEngine() {
  const config = testConfig({
    entities: [hero("hero-1", 1, 1, "movement", true, 3, { drawPile: allCards }), enemy("enemy-1", 7, 7)],
  });
  const engine = createSimulationEngine(config);
  engine.submit(modeCommand("player.enter_ranged_mode", "enter-ranged"));
  engine.advanceTicks(5);
  engine.advanceTicks(600);
  return { config, engine };
}

describe("deck lifecycle replay", () => {
  it("replays mode-entry deal, timer rotations and reshuffle with identical state hash and RNG journal audit", () => {
    const { engine } = makeEngine();
    const live = engine.snapshot();
    expect(engine.events().filter((event) => event.eventType === "deck.shuffled")).toHaveLength(2);
    expect(engine.events().filter((event) => event.eventType === "deck.rotation_resolved").map((event) => event.serverTick))
      .toEqual([305, 605]);
    expect(stateHashFromSnapshot(engine.replay(engine.events()))).toBe(stateHashFromSnapshot(live));
    expect(stateHashFromSnapshot(engine.replayJournal())).toBe(stateHashFromSnapshot(live));
  });

  it("rejects a tampered shuffle order, missing draw, or timer deadline during event replay", () => {
    const { engine } = makeEngine();
    const events = structuredClone(engine.events());
    const shuffle = events.find((event) => event.eventType === "deck.shuffled");
    if (!shuffle || shuffle.eventType !== "deck.shuffled") throw new Error("expected deck.shuffled");
    [shuffle.payload.orderedCardInstanceIds[0], shuffle.payload.orderedCardInstanceIds[1]] = [
      shuffle.payload.orderedCardInstanceIds[1]!,
      shuffle.payload.orderedCardInstanceIds[0]!,
    ];
    expect(() => engine.replay(events)).toThrow(/shuffle order|seedRef/);

    const missingDraw = [...structuredClone(engine.events())];
    const drawIndex = missingDraw.findIndex((event) => event.eventType === "card.drawn");
    missingDraw.splice(drawIndex, 1);
    expect(() => engine.replay(missingDraw)).toThrow(/sequence is not consecutive|deal is incomplete|followed by/);

    const badDeadline = structuredClone(engine.events());
    const rotation = badDeadline.find((event) => event.eventType === "deck.rotation_resolved");
    if (!rotation || rotation.eventType !== "deck.rotation_resolved") throw new Error("expected rotation event");
    rotation.payload.nextHandRotationAtTick += 1;
    expect(() => engine.replay(badDeadline)).toThrow(/due timer transition/);
  });

  it("rejects an altered RNG audit sidecar even when event payload order is untouched", () => {
    const { config, engine } = makeEngine();
    const records = structuredClone(engine.journalRecords());
    const shuffleRecord = records.find((record) => record.kind === "event" && record.event.eventType === "deck.shuffled");
    if (!shuffleRecord || shuffleRecord.kind !== "event" || shuffleRecord.rngAudit.length !== 1) {
      throw new Error("expected deck shuffle RNG audit record");
    }
    const audit = shuffleRecord.rngAudit[0] as unknown as { rngStateAfter: number[] };
    audit.rngStateAfter = [...audit.rngStateAfter];
    audit.rngStateAfter[0] = (audit.rngStateAfter[0]! + 1) >>> 0;
    expect(() => replayJournalRecords(createRuntimeState(config), records)).toThrow(/RNG audit state/);
  });
});
