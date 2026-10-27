# DR-C-002 — Enemy Registry + Deterministic Intent Simulation

- **Status:** `CONFIRMED`
- **Decision date:** 2026-10-27
- **Scope:** следующий инкремент Step C после headless grid movement
- **Package boundary:** `packages/rules` владеет runtime simulation; `packages/content` владеет immutable template catalog

## Decision

Implement the first Enemy Registry + Deterministic Intent Simulation increment with the exact wire-to-runtime mapping, active roster, timer, event, fallback, and RNG rules below. The canonical machine-readable template contract is `packages/contracts/intent.schema.json`; the runtime implementation must not create parallel wire fields for the same concepts.

## Content registry and active runtime roster

Register all three enemy templates in `packages/content`:

- `quarantine_chaser`
- `slag_shooter`
- `extinguisher`

The active runtime fixture for this increment contains only:

| Enemy | Active runtime handlers, in template order |
|---|---|
| `quarantine_chaser` | `move_close`, `melee_strike`, `hold_position` |
| `slag_shooter` | `ranged_shot`, `hold_position` |

`extinguisher` is catalog-only and must not appear in the active runtime fixture until both `bind` and `ally_guard` have runtime handlers. `reposition` may remain represented as a deferred content entry, but its status is `draft`; it is not an active handler and must not appear in an active fallback chain. Unsupported handlers are skipped by runtime selection and cannot be started by fallback processing.

## Canonical schema mapping

The schema/runtime mapping is one-way and explicit:

| Wire contract (`intent.schema.json`) | Runtime interpretation |
|---|---|
| `conditions` | typed `preconditions` evaluated against current authoritative state |
| `targetRules` | target policy, ordered fallback policies, range, LoS requirement, and candidate filters |
| `effect` | typed handler plus handler-specific parameters |
| `fallbackKeys` | ordered fallback candidates; try in listed order, then `hold_position` if the enemy roster permits it |
| `durationMs` | authoritative timer duration; derive `durationTicks = durationMs / 50` internally |

Requirements: `durationMs >= 3000` and `durationMs % 50 === 0`. The tick duration is fixed at 50 ms (20 Hz). `durationTicks`, `requiresLineOfSight`, `targetPolicy`, and `range` must not be added as duplicate wire fields; the existing `durationMs` and nested `targetRules` remain canonical.

## Runtime intent lifecycle

An active runtime intent stores its stable `activeIntentId`, owner, template key, lifecycle state, `startedAtTick`, `resolvesAtTick`, selected target ID/cell, optional public target cell, selection policy, RNG `seedRef`, and cancellation reason. Runtime time is authoritative and advances only on server ticks.

When an intent starts, emit `intent.started`; if a target was selected, emit `intent.target_selected` in the same scene event batch. On the due tick, revalidate current state before any effect. Emit `intent.resolved` for a valid resolution, followed by its domain mutation event(s), such as `scene.entity_moved` or `hp.changed`. An invalid intent emits `intent.cancelled`; a valid fallback may start in the same tick. Each non-empty scene mutation/event batch receives one `sceneRevision`.

The canonical `intent.target_selected` event is authoritative GM/audit data and includes the exact target, target cell, policy, tie-break mode, and `seedRef`. TV/player projection must omit target identity, policy, seed, and audit details. A public target cell may be projected only when separately approved by the intent's visibility/reveal policy; a projection helper must default to withholding the cell.

## Target selection

First apply the template's faction, alive-state, status, range, and LoS filters. Then rank candidates according to the declared policy (`nearest_player`, `current_target`, `highest_threat`, `nearest_visible_player`, or `lowest_ally_hp_percentage`). The grid uses Chebyshev distance for range/contact, consistent with the confirmed rule that diagonal adjacency counts as melee contact. When multiple candidates share the best rank, select among them using the intent-scoped `target_selection` RNG fork. A unique candidate requires no random draw. The exact target and tie-break mode are journaled; replay consumes the recorded event and does not rerun selection.

## Deterministic RNG

- Canonical algorithm name: `xoshiro128**`; `xoshiro128ss` is only an internal implementation shorthand. `algorithmVersion`: `fable.rng.v1`.
- Encoding: UTF-8.
- Fork input fields, in order: `rootSeed`, `campaignId`, `sceneId`, `serverTick`, `activeIntentId`, and a purpose string.
- Canonical fork serialization: compact JSON array of those six fields, encoded as UTF-8; `seedRef` is the lowercase hexadecimal SHA-256 digest.
- Active purposes for this increment: `target_selection`, `fallback_selection`, `deck_shuffle`. `retreat_attack_order` is deferred future scope; retreat ordering in DR-C-003 is deterministic `enemyId` ascending and uses no RNG.
- The in-memory journal retains per-event RNG audit sidecars with algorithm version, fork input, seed reference, and before/after xoshiro state. RNG state/audit data is not exposed to player/TV projections.
- `fallbackKeys` are an explicitly ordered list, so fallback processing tries candidates in that order; it does not randomly reorder them. The separate `fallback_selection` fork identifies and audits that decision stream.

The implementation must not use `Math.random()` or wall-clock time in gameplay logic.

## Supported handlers and effects in this increment

| Handler | Behavior |
|---|---|
| `move_close` | on due tick, move the enemy by up to two deterministic greedy one-cell steps toward the selected target; stop at blocked or contact cells |
| `melee_strike` | revalidate target contact and pass the template's `rawDamage` to the shared `fable.damage.v1` pipeline with multiplier `1` |
| `ranged_shot` | revalidate range and line of sight, then pass the template's `rawDamage` to the shared `fable.damage.v1` pipeline with multiplier `1` |
| `hold_position` | no scene effect; complete the timer and reevaluate the enemy's ordered runtime intent list |

This increment does not activate `reposition`, `bind`, or `ally_guard` handlers. It does not implement status application, cards, stamina, environment effects, or the full combat system.

Damage events use `hp.changed` v2; historical v1 events remain replayable. A hero at 0 HP is not a valid target. An enemy at 0 HP cannot resolve or start intents and is removed during cleanup; an active intent is cancelled with `owner_removed` before `scene.entity_removed`. See [DR-C-004](./18-step-c-hp-damage-resolution.md).

## Impossible intent and fallback

At resolution, revalidate target, path, range, LoS, and handler preconditions against the authoritative state. An impossible intent must not partially mutate gameplay state. Emit `intent.cancelled` with the detected reason, then inspect the ordered `fallbackKeys` list followed by `hold_position`, skipping duplicates, unregistered templates, unsupported handlers, templates not allowed by that enemy, and candidates whose preconditions fail. Start the first valid fallback. If none is valid, emit the terminal cancellation reason `no_valid_fallback`, leave the enemy without an active intent, and do not retry the same impossible intent in that tick.

## Verification and golden transcript

Tests must cover roster/handler gating, all supported effects, target filters and seeded ties, timer deadlines in 50 ms ticks, fallback success and terminal failure, all four intent events, public/GM projection boundaries, JSON Schema conformance, repeated same-seed runs, and exact journal replay. A checked-in golden transcript records the fixed-seed event trace and final `stateHash`; regression tests compare the complete transcript, not an approximate reconstruction. At least one long-run replay must cover 100+ ticks and prove exact live/replay state and hash equality.
