# Verified combat-rules inventory

**Audit baseline:** `fable-rpg/main` at `7770d04` (2026-10-28)
**Purpose:** reconcile declared rules, executable behavior, and test coverage before widening browser-facing gameplay. This is a status/inventory document; it does not create unapproved production mechanics.

## Evidence standard

- **Implemented** means the behavior is present in the checked runtime/source.
- **Tested** names a regression that exercises the checked behavior.
- **Deferred** means the runtime intentionally has no model or resolution for the product idea.
- **Open decision** requires a dedicated DR before behavior, data shape, balance, or compatibility changes.

The baseline passed `pnpm check` (189 tests in 43 files), `pnpm build`, and `git diff --check` in this maintenance worktree.

## 1. Ranged availability and distance

| Area | Declared and implemented behavior | Tests | Result |
|---|---|---|---|
| Entry to ranged mode | [DR-C-003](./16-step-c-retreat-resolution.md) and `SimulationEngine.applyModeCommand()` use `hero.canEnterRangedMode === true` as the only Step C entry gate. The capability is part of runtime state, snapshots, replay, and state hash. | `heroModes.integration.test.ts` accepts the capability-true fixture and rejects capability-false. The accepted fixture has no card instances, proving the gate is not inferred from deck contents. | **Confirmed for the current runtime.** |
| Deck availability | `deckLifecycle.ts` filters/deals card instances by `CardTemplate.allowedModes` after mode transition. Card availability, range, LoS, and stamina are independently revalidated at play time. | `deck-lifecycle.integration.test.ts`; card-play unit/integration tests. | **Implemented separately from entry capability.** |
| Player-card range/LoS | `resolvePlayCard()` uses Chebyshev distance `max(|dx|, |dy|)` with inclusive template bounds and checks LoS only when the template requires it. | `card-play.unit.test.ts`, `card-play.integration.test.ts`. | **Implemented.** |
| Enemy ranged intent | Enemy targeting uses the same Chebyshev metric and inclusive bounds. Production `ranged_shot` is 2–7 cells with required LoS. | `intents.integration.test.ts` checks target eligibility, range, LoS, ranking, tie-breaking, and damage. | **Implemented.** |

The former Vertical Slice text making an eligible ranged deck the entry gate is superseded for the Step C runtime. It is a deck/deal concern, not a replacement for the authoritative hero capability.

## 2. Card categories and magic

### Current executable subset

`CardTemplate` contains `key`, `version`, `allowedModes`, `staminaCost`, `range`, `lineOfSight`, and one effect kind: `direct_damage`, `prevent_one_attack`, `damage_barrier`, or `apply_ally_guard`. The active fixtures are explicitly `TEST_ONLY / NON_BALANCE`.

`allowedModes` is an eligibility filter, **not** a card taxonomy. The runtime has no `category`, `magic`, `damageType`, `item`, `potion`, `throwable`, `skill`, or production-catalog field. `resolvePlayCard()` therefore does not apply a melee magic multiplier. Defense-slot effects and generic direct damage are covered by card/deck tests, but no test can establish magic classification because the field does not exist.

### Status

The historic product text stating that magic in melee deals 50% less damage without reducing status potency is **DEFERRED**. It must not be inferred from `allowedModes`, a direct-damage effect, or a hard-coded multiplier.

### Required decision before implementation

A dedicated card-taxonomy DR must decide whether production direct-damage cards expose an explicit damage/category discriminator, how universal/item/skill cards are represented, when the melee modifier applies, how status potency is separated from damage, and how content/event/replay compatibility is versioned. Until then, no magic behavior is added to the Step C subset.

## 3. Hit, miss, and critical outcomes

### Current executable subset

A semantically valid current direct-damage card or enemy attack proceeds deterministically through `fable.damage.v1`. There is no hit check, critical check, miss multiplier, card/stat input for them, RNG purpose, audit record, event payload, or replay reducer branch. This is consistent with DR-C-003 retreat damage and DR-C-004 current damage scope.

### Status

Hit/miss/critical product wording is **DEFERRED**, not a partially active hidden mechanic. In particular, no numeric hit chance, miss coefficient, or critical chance may be chosen during UI or content work.

### Required decision before implementation

The future DR must specify data inputs, probability/value ranges, deterministic RNG purpose and audit data, exact ordering relative to mitigation/magic/status/protection, `hp.changed` or dedicated event shape, replay validation, and whether partial miss is a generic system or an explicit card effect. Then add fixed-seed boundaries and tamper/replay tests.

## 4. Damage calculation and application

### Confirmed current formula

All current damage sources use `fable.damage.v1`:

```text
mitigation = 100 / (100 + defense)
mitigatedDamage = ceil(rawDamage * mitigation)
finalDamage = ceil(mitigatedDamage * multiplier)
hpAfter = max(0, min(maximum, hpBefore - finalDamage))
```

The two rounding stages are deliberate. The multiplier is not pre-rounded. `finalDamage` is the formula result; `appliedDamage` is the actual HP reduction after clamp. An `hp.changed` v2 event is emitted only if HP changes and records formula inputs/result for the authoritative/GM view.

### Sources and consequences

- Enemy `melee_strike` and `ranged_shot` use multiplier `1`.
- Retreat attacks use multiplier `1 / attackOrder` after stable ascending `enemyId` order.
- Direct-damage cards use the same pipeline through DR-C-006.
- Enemy-sourced damage can consume the current hero protections before HP mutation. Ally Guard changes effective defense by 20% while its status is active; it does not mutate base defense.
- A hero at 0 HP becomes `critically_injured`, cannot act, and has stamina/deck timers cleared. An enemy at 0 HP is immediately ineligible, then removed during cleanup while retained as a replay/state-hash tombstone.

### Tests

`damage.unit.test.ts`, `damage.integration.test.ts`, `intents.integration.test.ts`, card-play tests, retreat tests, Ally Guard tests, event-schema tests, and replay tests cover staged rounding, HP clamp, event metadata, damage sources, protections, cleanup, and replay/state-hash parity.

### Open float/version decision

The implementation uses JavaScript `number`. With raw damage 259, base defense 3, and active 20% Ally Guard, binary floating point makes effective defense `3.5999999999999996`; the current formula produces 251 while exact rational arithmetic would produce 250. This is a documented edge, not a silent `fable.damage.v1` change. Decide the required arithmetic contract and any `fable.damage.v2` compatibility/migration policy before adding an expected-value regression test or changing code.

## 5. Documentation corrections made with this inventory

- The Step C Vertical Slice and core-engine text now state the authoritative ranged-capability gate and current Chebyshev range behavior.
- Current docs explicitly defer magic and hit/miss/critical mechanics rather than describe unimplemented behavior as active.
- The Balance Sheet now refers to the two-stage `fable.damage.v1` calculation; it no longer presents a conflicting one-ceiling hit multiplier formula.
- DR-C-004 now records DR-C-006 direct-damage cards as an active shared-pipeline source.

## 6. Remaining prioritised work

1. Obtain the three narrow decisions above: card taxonomy/magic, hit/miss/critical, and damage float/version semantics.
2. Keep multi-scene sequence allocation and rollback confirmation/durable request receipt work as separate integration gates.
3. Only after the applicable decisions and tests exist, widen the typed WebSocket/UI command set. Do not expand to world map, NPC dialogue, campaign systems, or production UI in this scope.
