# Fable — development log and AI handoff

**Updated:** 2026-10-29
**Current `main` baseline:** `df627f6` — PR #23 (Stage 7 visibility matrix)
**Documentation scope:** synchronized against PRs #19–#23

This document is a routing and handoff page, not a replacement for confirmed rules, Decision Records, JSON Schemas, code, or tests. For the checked combat-rule matrix, read [the verified inventory](./30-verified-combat-rules-inventory.md).

## 1. Current state

The active runtime is a TypeScript/pnpm workspace requiring Node.js `>=22 <23`:

- `packages/rules` (`@fable/rules`) is the authoritative, deterministic headless engine: scheduler, commands, movement, modes, intents, cards, damage, statuses, campaign outcomes, snapshots, journal, replay, and state hash.
- `packages/content` (`@fable/content`) owns immutable enemy and intent catalog data.
- `packages/vertical-slice` (`@fable/vertical-slice`) is the active Player/GM/TV adapter: in-memory and WebSocket transports, auth/membership interfaces, role-filtered projections/events, and both reference in-memory and durable SQLite persistence.
- `packages/contracts` contains canonical JSON Schemas and is not a separate workspace runtime package.
- `dev/` is an obsolete TypeScript/Colyseus/Drizzle scaffold with a parallel state model. It is not an adapter over `@fable/rules`, is not covered by the active workspace dependencies, and must not be extended as the product runtime.
- `reference/gdd-site/` is explanatory reference material only.

Step C increments 1–10 are in `main`. PR #14 integrated the former PR #9–#13 audit follow-ups; PR #15 added the Player/GM WebSocket slice; PR #16–#18 corrected event visibility, enemy target ranking, and pause/restore/outcome lifecycle. The current `main` also includes PR #19–#23: recipient-specific projection fan-out; reconnect, input-validation, rate-limit, and idempotency regressions; safe structured diagnostics; durable SQLite persistence and crash recovery; and Stage 7 Player/TV/GM visibility projections with negative security tests. The current baseline is `df627f6` (PR #23). The only currently open GitHub PR in `fable-rpg` is legacy stacked PR #4, whose head `55119c` is already an ancestor of `main`; it has no unique implementation work to merge.

### Persistence status and database decision

[DR-INFRA-001](./31-database-persistence-decision.md) selects SQLite for the current vertical slice and the first single-process/single-node playable deployment. This is a real durable implementation, not only an in-memory mock: `SqliteSlicePersistence` uses Node's built-in `node:sqlite` / `DatabaseSync` and creates `sessions`, `snapshots`, `command_requests`, and `campaign_events`. A caller must supply a file path that lives on persistent storage; the constructor's default `:memory:` mode is ephemeral.

PostgreSQL/Drizzle in [`docs/09-database-schema.md`](./09-database-schema.md) now denotes a future normalized campaign/lore target design, not the active runtime. `dev/database/schema.ts` is an obsolete scaffold and must not be extended as if it powered `@fable/vertical-slice`. SQLite remains the chosen path until requirements such as multiple active writers/replicas or managed shared persistence justify a separate database decision.

One concrete persistence contract issue remains to verify: SQLite currently declares `command_requests.request_id` as a primary key, while earlier idempotency documentation scopes the key by `(session_id, actor_id, request_id)`. See the follow-up in DR-INFRA-001; do not assume cross-session request-ID reuse is safe until the contract, schema, and tests agree.

## 2. What the latest audit confirmed

### Prior tasks checked against code and history

| Task | Current evidence | Status |
|---|---|---|
| Player/GM event visibility | PR #16 (`41450e8`) introduced role-filtered domain-event projection. Its WebSocket regression verifies redaction of target selection and damage internals for Player while retaining GM data. The audit found a separate projection fan-out flaw: `broadcastAllProjections()` sent both Player and GM projections to every session. Merged PR #19 fixes recipient-specific fan-out and verifies serialized WebSocket projections plus the GM-pause update path; PR #23 extends the matrix to Player, GM, and TV with negative security tests. | Implemented in merged PR #19 and extended by PR #23; do not treat PR #16 alone as a complete transport-visibility proof. |
| Enemy target selection | PR #17 (`eb6b960`) ranks every eligible candidate before seeded tie-breaking. `intents.integration.test.ts` proves a high-threat candidate wins regardless of entity-ID ordering and that equal-score ties remain deterministic. | Implemented and regression-covered. |
| Pause, restore, outcome lifecycle, reconnect state | PR #18 (`a4fb756`) made `paused` authoritative runtime/snapshot state; freezes ticks while paused; restores pause state; and clears temporary combat state on outcome while preserving persistent hero state. Focused rules and vertical-slice tests cover pause/restore/outcome behavior. | Implemented and regression-covered for the in-memory adapter. Durable restart/idempotency is still a separate persistence gate. |

### Verification reported for current `main`

The latest merged PR (#23) reports these checks passing on its change:
- `pnpm -r typecheck` — 0 errors;
- `pnpm -r lint` — 0 errors / warnings;
- `pnpm check` — 207 tests across the monorepo, including 26 vertical-slice tests.

Earlier merged PRs separately reported successful `pnpm build` and `git diff --check` (PR #21 and PR #19, respectively). These are historical PR-reported results; they have **not** been rerun by this documentation-only change. Re-run the full gate after any runtime/code change and report only commands actually executed.


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
5. **Rollback confirmation:** the B-005 confirmation-token boundary remains a separate integration gate.
6. **SQLite idempotency scope:** verify the current `request_id` primary-key behavior against the intended `(session_id, actor_id, request_id)` scope before allowing request IDs to be reused across sessions/actors; track this independently from the database-engine decision.

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
