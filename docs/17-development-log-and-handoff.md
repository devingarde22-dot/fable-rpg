# Fable — development log and AI handoff

**Updated:** 2026-10-28
**Audited `main` baseline:** `7770d04` — merge of PR #18
**This maintenance branch:** `docs/rules-audit-sync-2026-10-28`

This document is a routing and handoff page, not a replacement for confirmed rules, Decision Records, JSON Schemas, code, or tests. For the checked combat-rule matrix, read [the verified inventory](./30-verified-combat-rules-inventory.md).

## 1. Current state

The active runtime is a TypeScript/pnpm workspace requiring Node.js `>=22 <23`:

- `packages/rules` (`@fable/rules`) is the authoritative, deterministic headless engine: scheduler, commands, movement, modes, intents, cards, damage, statuses, campaign outcomes, snapshots, journal, replay, and state hash.
- `packages/content` (`@fable/content`) owns immutable enemy and intent catalog data.
- `packages/vertical-slice` (`@fable/vertical-slice`) is the active Player/GM adapter, including WebSocket transport, auth/membership interfaces, projections, and an in-memory persistence implementation.
- `packages/contracts` contains canonical JSON Schemas and is not a separate workspace runtime package.
- `dev/` is an obsolete TypeScript/Colyseus/Drizzle scaffold with a parallel state model. It is not an adapter over `@fable/rules`, is not covered by the active workspace dependencies, and must not be extended as the product runtime.
- `reference/gdd-site/` is explanatory reference material only.

Step C increments 1–10 are in `main`. PR #14 integrated the former PR #9–#13 audit follow-ups; PR #15 added the minimal Player/GM vertical slice; PR #16–#18 are merged into the audited baseline. The only currently open GitHub PR in `fable-rpg` is legacy stacked PR #4, whose head `55119c` is already an ancestor of `main`; it has no unique implementation work to merge.

## 2. What the latest audit confirmed

### Prior tasks checked against code and history

| Task | Current evidence | Status |
|---|---|---|
| Player/GM event visibility | PR #16 (`41450e8`) introduced role-filtered domain-event projection. Its WebSocket regression verifies redaction of target selection and damage internals for Player while retaining GM data. The audit found a separate projection fan-out flaw: `broadcastAllProjections()` sent both Player and GM projections to every session. This branch fixes the fan-out and verifies serialized WebSocket projections plus the GM-pause update path. | Corrected in this branch; do not treat PR #16 alone as a complete transport-visibility proof. |
| Enemy target selection | PR #17 (`eb6b960`) ranks every eligible candidate before seeded tie-breaking. `intents.integration.test.ts` proves a high-threat candidate wins regardless of entity-ID ordering and that equal-score ties remain deterministic. | Implemented and regression-covered. |
| Pause, restore, outcome lifecycle, reconnect state | PR #18 (`a4fb756`) made `paused` authoritative runtime/snapshot state; freezes ticks while paused; restores pause state; and clears temporary combat state on outcome while preserving persistent hero state. Focused rules and vertical-slice tests cover pause/restore/outcome behavior. | Implemented and regression-covered for the in-memory adapter. Durable restart/idempotency is still a separate persistence gate. |

### Verification actually run in this worktree

Before edits, the following completed successfully on the `7770d04` baseline:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
git diff --check
```

`pnpm check` reported **189 passing tests in 43 files**: 6 content, 175 rules, and 8 vertical-slice tests. After the projection-fan-out fix, this focused suite also passed:

```bash
pnpm --filter @fable/vertical-slice test -- tests/websocket.integration.test.ts tests/vertical-slice.integration.test.ts
```

It reported 8 passing tests in 2 files. Re-run the full gate after all branch changes before merge.

## 3. Decisions and executable behavior

- **Ranged entry:** `hero.canEnterRangedMode === true` is the authoritative Step C admission gate ([DR-C-003](./16-step-c-retreat-resolution.md)). Deck filtering happens after a combat-mode transition and is not a second entry gate. A ranged-capable hero can enter with an empty eligible pool in the current fixture/runtime model.
- **Range/LoS:** current player cards and enemy intents use Chebyshev distance with inclusive bounds; their own template determines range and LoS. `ranged_shot` is range 2–7 with LoS.
- **Damage:** all current sources use `fable.damage.v1`: mitigation, a ceiling after mitigation, then a ceiling after multiplier; HP is clamped and `hp.changed` v2 records the calculation. Direct-damage cards were added by DR-C-006 and use the same pipeline.
- **Cards/magic:** the active `CardTemplate` has `allowedModes`, range, LoS, stamina cost, and effect kind, but no category, magic marker, damage type, item, or skill model. The old magic-in-melee wording is not implemented and is explicitly deferred.
- **Hit/miss/critical:** no current Step C source rolls hit or critical probability. A valid current direct-damage action resolves deterministically; no hit/crit RNG purpose or outcome event exists.

## 4. Open decisions and integration gates

Do not resolve these by modifying an unrelated UI/transport task:

1. **Card taxonomy and magic:** decide the explicit content contract for magic/items/categories and the placement/versioning of the melee modifier before production cards use it.
2. **Hit/miss/critical:** decide inputs, probabilities, deterministic RNG/audit, calculation order, event/replay data, and partial-miss behavior before implementation.
3. **Damage float policy:** `fable.damage.v1` uses JavaScript numbers. The documented `raw=259`, base defense `3`, Ally Guard `+20%` edge produces 251 while exact rational arithmetic produces 250. Any semantic correction must be a versioned Decision Record with replay compatibility; do not change v1 silently.
4. **Campaign-global sequence:** multiple independent scene engines do not yet share an allocator.
5. **Rollback confirmation and durable idempotency:** the in-memory engine lacks the B-005 confirmation-token boundary and snapshot restore does not preserve terminal request receipts. Treat persistence/restart semantics as a separate design and test scope.

The historic retreat-node text was aligned to the confirmed DR-C-010 behavior: `retreat` blocks the reward but leaves the node repeatable.

## 5. Next priority

The next work item is a narrow rules-decision PR, not a world-map, dialogue, campaign, or full UI expansion:

1. adopt separate DRs for **card taxonomy/magic**, **hit/miss/critical**, and **damage float/version semantics**;
2. add table-driven/fixed-seed/replay tests only after each approved rule exists;
3. then expose only those accepted commands in the browser-facing adapter/UI.

In parallel, integration planning may specify campaign-wide event sequencing and durable rollback/idempotency, but must not rewrite combat rules.

## 6. Required continuation procedure

1. Start from current `main`, create a named feature branch, and keep code changes in `fable-rpg`; synchronize planning/status material in `fable-context` separately.
2. Read `README.md`, `docs/README.md`, this handoff, the relevant Decision Record and schema, then the specific source and test.
3. Preserve deterministic replay/state-hash parity and backend visibility filtering.
4. Run at least `pnpm check`, `pnpm build`, and `git diff --check` for code or contract changes; report the exact result actually obtained.
5. Do not claim a historical check was rerun. Mark unresolved product behavior as `OPEN_QUESTION` or `DEFERRED` and link its decision request.
