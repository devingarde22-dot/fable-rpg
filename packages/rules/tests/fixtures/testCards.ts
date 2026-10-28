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

export const testPreventOneAttack = {
  key: "test-only-prevent-one-attack", version: 1, allowedModes: ["movement", "melee", "ranged"],
  staminaCost: 1, range: { minInclusive: 0, maxInclusive: 1 }, lineOfSight: "not_required",
  effect: { kind: "prevent_one_attack" }, fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testDamageBarrier = {
  key: "test-only-damage-barrier", version: 1, allowedModes: ["movement", "melee", "ranged"],
  staminaCost: 1, range: { minInclusive: 0, maxInclusive: 1 }, lineOfSight: "not_required",
  effect: { kind: "damage_barrier", amount: 50 }, fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testAllyGuardCard = {
  key: "test-only-ally-guard", version: 1, allowedModes: ["movement", "melee", "ranged"],
  staminaCost: 1, range: { minInclusive: 0, maxInclusive: 4 }, lineOfSight: "not_required",
  effect: { kind: "apply_ally_guard" }, fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testGoldenFinisher = {
  key: "test-only-golden-finisher",
  version: 1,
  allowedModes: ["ranged"],
  staminaCost: 1,
  range: { minInclusive: 1, maxInclusive: 8 },
  lineOfSight: "not_required",
  effect: { kind: "direct_damage", rawDamage: 5_000, multiplier: 1 },
  fixtureClassification: TEST_ONLY_NON_BALANCE,
} as const satisfies CardTemplate & { fixtureClassification: typeof TEST_ONLY_NON_BALANCE };

export const testCardTemplates: readonly CardTemplate[] = [
  testCostedRangedStrike,
  testFreeMeleeStrike,
  testFreeRangedStrike,
  testModeNeutralStrike,
  testPreventOneAttack,
  testDamageBarrier,
  testAllyGuardCard,
  testGoldenFinisher,
];
