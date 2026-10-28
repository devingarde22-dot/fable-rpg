import { createSimulationEngine } from "../../src/engine/SimulationEngine.js";
import type { SimulationEngineConfig } from "../../src/engine/types.js";
import { enemy, hero, testConfig } from "../createTestEngine.js";
import { testAllyGuardCard, testCostedRangedStrike, testDamageBarrier, testFreeMeleeStrike, testFreeRangedStrike, testModeNeutralStrike, testPreventOneAttack } from "./testCards.js";

export const QUARANTINE_GATES_START_CELLS = [
  { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 5 }, { x: 1, y: 6 },
] as const;

export const QUARANTINE_GATES_TERRAIN = [
  { cell: { x: 4, y: 2 }, terrain: "wall" as const },
  { cell: { x: 4, y: 3 }, terrain: "wall" as const },
  { cell: { x: 4, y: 5 }, terrain: "statue" as const },
];

const normalHand = [testCostedRangedStrike, testFreeMeleeStrike, testFreeRangedStrike, testModeNeutralStrike, testFreeMeleeStrike];

export function quarantineGatesConfig(partySize = 4): SimulationEngineConfig {
  if (!Number.isInteger(partySize) || partySize < 2 || partySize > 4) throw new RangeError("Quarantine Gates fixture supports 2–4 heroes");
  const actors: Record<string, string> = {};
  const heroes = QUARANTINE_GATES_START_CELLS.slice(0, partySize).map((cell, index) => {
    const actorId = `actor-${index + 1}`;
    const heroId = `hero-${index + 1}`;
    actors[actorId] = heroId;
    return hero(heroId, cell.x, cell.y, "movement", true, 3, {
      hand: normalHand.map((card, cardIndex) => ({ instanceId: `${heroId}-card-${cardIndex + 1}`, templateKey: card.key })),
      defenseSlot: { instanceId: `${heroId}-defense`, templateKey: [testPreventOneAttack, testDamageBarrier, testAllyGuardCard][index % 3]!.key },
    });
  });
  return testConfig({
    campaignId: "campaign-quarantine-gates",
    sessionId: "session-quarantine-gates",
    sceneId: "quarantine-gates",
    rootSeed: "quarantine-gates-golden-seed-v1",
    terrain: QUARANTINE_GATES_TERRAIN,
    entities: [
      ...heroes,
      enemy("enemy-chaser", 7, 7, "quarantine_chaser"),
      enemy("enemy-shooter", 7, 1, "slag_shooter"),
      enemy("enemy-extinguisher", 7, 4, "extinguisher"),
    ],
    initialIntentByEnemyId: { "enemy-chaser": "move_close", "enemy-shooter": "ranged_shot" },
    heroIdByActorId: actors,
  });
}

export function createQuarantineGatesEngine(partySize = 4) {
  return createSimulationEngine(quarantineGatesConfig(partySize));
}
