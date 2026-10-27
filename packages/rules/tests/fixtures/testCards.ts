import type { CardTemplate } from "../../src/engine/types.js";

/** These fixtures are deliberately non-balanced and must never enter the production card catalog. */
export const TEST_ONLY_NON_BALANCE = "TEST_ONLY / NON_BALANCE" as const;

export const testCostedRangedStrike = {
  key: "test-only-ranged-strike",
  version: 1,
  allowedModes: ["ranged"],
  staminaCost: 1,
  range: { minInclusive: 1, maxInclusive: 5 },
  lineOfSight: "required",
  effect: { kind: "direct_damage", rawDamage: 37, multiplier: 1 },
  fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testFreeMeleeStrike = {
  key: "test-only-free-melee-strike",
  version: 1,
  allowedModes: ["melee"],
  staminaCost: 0,
  range: { minInclusive: 1, maxInclusive: 1 },
  lineOfSight: "not_required",
  effect: { kind: "direct_damage", rawDamage: 23, multiplier: 1 },
  fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testFreeRangedStrike = {
  key: "test-only-free-ranged-strike",
  version: 1,
  allowedModes: ["ranged"],
  staminaCost: 0,
  range: { minInclusive: 1, maxInclusive: 5 },
  lineOfSight: "required",
  effect: { kind: "direct_damage", rawDamage: 19, multiplier: 1 },
  fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testModeNeutralStrike = {
  key: "test-only-neutral-strike",
  version: 1,
  allowedModes: ["melee", "ranged"],
  staminaCost: 0,
  range: { minInclusive: 1, maxInclusive: 5 },
  lineOfSight: "required",
  effect: { kind: "direct_damage", rawDamage: 29, multiplier: 1 },
  fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testCardTemplates: readonly CardTemplate[] = [
  testCostedRangedStrike,
  testFreeMeleeStrike,
  testFreeRangedStrike,
  testModeNeutralStrike,
];
