# Increment 9 — Ally Guard Runtime (DR-C-009)

**Decision:** DR-C-009 — confirmed implementation scope.
**Implementation branch:** `step-c-increment-9-ally-guard`, based on the merged Increment 8 `main`.
**Status:** implemented and verified; commit `226f654` is published in PR [#7](https://github.com/devingarde22-dot/fable-rpg/pull/7) targeting `main`.
**Scope:** implement the existing `ally_guard` intent handler and activate the existing `extinguisher` in the runtime roster. No new production content is added.

## 1. Confirmed behavior

The existing `ally_guard` intent chooses its target using the existing content template's `lowest_ally_hp_percentage` policy, enemy-faction/alive-state filters, range 1–4 and no LoS requirement. Its existing parameters are a 20% defense bonus and a 15-second duration. Do not change the content values or targeting rules.

The effect is represented by one `ally_guard` status layer on the target. It lasts 300 authoritative ticks. While active, damage calculations use:

```text
effectiveDefense = baseDefense * 1.20
```

No intermediate rounding is performed. The fractional effective defense is passed to `fable.damage.v1`; its existing damage-calculation stages remain the only places where damage is rounded. Base entity defense is never overwritten.

`ally_guard` uses `refresh_duration`. A successful repeat application preserves the existing layer ID, original `sourceEntityId`, potency and stack count; it updates `appliedAtTick` and sets `expiresAtTick = applicationTick + 300`. Potency does not stack or increase. The refresh event's envelope actor identifies the latest applying enemy.

The status remains effective through gameplay resolution on its due tick and expires in the existing status cleanup phase afterward. Expiration ordering remains entity ID, then layer ID.

## 2. Runtime activation and content policy

`bind` and `ally_guard` are the two required status-effect handlers for the existing `extinguisher`; both are implemented and the existing `extinguisher` template and supported intent keys are active in the runtime roster in `packages/content`. No enemy or intent templates, card content, or other production content were added or rebalanced. `reposition` remains deferred and inactive.

## 3. Events, replay and state hash

For a successful guard resolution, event order is:

```text
intent.resolved
→ status.applied | status.refreshed
→ next intent events, if any
```

The existing status events identify target, status key, layer ID, and the full 15,000 ms timer. `publicPotency` is required for applied/refreshed events and is 20 for Ally Guard. Replay reruns the deterministic Ally Guard target selection, including eligibility, range, policy, tie-break and seed validation. `hp.changed` v2 records the effective defense actually used by `fable.damage.v1`; replay recomputes it from the active status and rejects altered defense, damage, timer, potency, target, or omitted status events.

The state hash continues to include canonical status layer fields. Live simulation, event replay and journal replay must produce identical snapshots and hashes.

## 4. Test plan

- **Unit:** effective defense without a layer and with Ally Guard, including fractional defense; apply and refresh preserve ID/source/potency/stacks and renew only the deadline; exact due-tick effectiveness and deterministic expiration.
- **Integration:** existing `extinguisher` can start and resolve its existing `ally_guard` intent; target choice follows the catalog filter/policy; a later damage event uses fractional effective defense; after expiration, damage returns to base defense. Reapplication refreshes the same layer without stacking.
- **Replay:** applied/refreshed/expired transactions, altered Ally Guard target/policy rejection, altered effective-defense and timer rejection, missing status event or public potency rejection, exact live/event/journal snapshot and `stateHash` parity.
- **Content/schema:** active runtime roster contains the existing `extinguisher` with `bind`, `ally_guard`, `move_close`; `reposition` stays inactive. Canonical event schemas accept valid Ally Guard events and reject malformed potency/duration/status payloads.
- **Golden transcript:** update the fixed-seed transcript to cover the newly active support intent and its deterministic events.
- **Quality gates:** full `pnpm check`, `pnpm build`, JSON Schema/Ajv tests and `git diff --check`.

## 5. Explicit exclusions

Defense card slot, card effects, new content or balance changes, new status types, generic stacking policies, `reposition`, UI/projections, WebSocket/Colyseus, persistence, authentication, deployment, and AI remain out of scope.

## 6. Definition of Done

- Existing `ally_guard` template executes with the confirmed targeting, 20% defense and 15-second timer.
- Fractional effective defense reaches `fable.damage.v1` unchanged; base defense remains unchanged.
- Refresh preserves layer ID/source/potency/stacks and changes only application/expiry ticks.
- Existing `extinguisher` is activated only after both required handlers are supported; no new content is added.
- Events, schemas, live/replay/journal state and `stateHash` agree deterministically; golden transcript is updated.
- Full workspace checks pass.

## 7. Implementation result

- Implemented on `step-c-increment-9-ally-guard`; commit `226f654` is published in PR [#7](https://github.com/devingarde22-dot/fable-rpg/pull/7) targeting `main`.
- `pnpm check` passed: typecheck, lint, and all 147 workspace tests (5 content, 142 rules; 33 rules test files).
- `pnpm build` passed for `@fable/content` and `@fable/rules`; final targeted Ally Guard/replay/schema regressions passed 12 tests.
- Canonical JSON Schema parses and Ajv tests pass; updated fixed-seed golden transcript matches live simulation; `git diff --check` passes.
