# Fable — RPG Engine Repository

`fable-rpg` is the active source repository for Fable. The separate public context pack, [`devingarde22-dot/fable-context`](https://github.com/devingarde22-dot/fable-context), is a synchronized planning aid; it must not override the current code, tests, contracts, or merged Git history here.

## Verified current baseline

The current `main` baseline is [`df627f6`](https://github.com/devingarde22-dot/fable-rpg/commit/df627f6e1d1a50599c75c51ef3a52446efeffd5a), merged PR #23 on 2026-10-28. It includes:

- Step C increments 1–10 and the headless Quarantine Gates vertical slice;
- the PR #9–#13 integration through PR #14 and the Player/GM WebSocket slice from PR #15;
- PR #19's role-specific projection fan-out fix and CI workflow;
- PR #20's Player/GM reconnect and invalid-input/rate-limit regression coverage;
- PR #21's safe structured diagnostics and WebSocket retry/idempotency coverage;
- PR #22's durable SQLite persistence and crash-recovery integration tests;
- PR #23's TV projection, Player resource projection, visibility matrix, and negative security tests.

PR #4 remains open on GitHub, but its head commit `55119c` is already an ancestor of `main`; it is a legacy stacked PR, not pending implementation work. Do not merge it as new work.

The latest merged PR (#23) reports `pnpm -r typecheck`, `pnpm -r lint`, and `pnpm check` passing, with **207 tests in the monorepo (26 in vertical-slice)**. These are PR-reported results; they have not been rerun as part of this documentation change.

### Active persistence decision

The current durable persistence implementation is `SqliteSlicePersistence` in `packages/vertical-slice/src/sqlitePersistence.ts`, using Node's built-in `node:sqlite`. SQLite is the selected store for the current vertical slice and an initial single-process/single-node playable deployment—not just a mock. The default `:memory:` mode is ephemeral; durable operation requires an explicit database file path and persistent storage. PostgreSQL/Drizzle is a future option, not the active runtime. See [DR-INFRA-001](docs/31-database-persistence-decision.md) and the [database schema target design](docs/09-database-schema.md).

## Read this repository in order

1. [`docs/README.md`](docs/README.md) — reading order and full document catalog.
2. [`docs/17-development-log-and-handoff.md`](docs/17-development-log-and-handoff.md) — current runtime, verified history, open decisions, and next work.
3. [`docs/30-verified-combat-rules-inventory.md`](docs/30-verified-combat-rules-inventory.md) — implementation-backed inventory of ranged availability, cards/magic, hit/miss/critical, and damage.
4. The applicable confirmed rule, JSON Schema, Decision Record, source, and test for the task.

Markdown contracts and JSON Schemas define intended behavior. The current `main` source, tests, and merged history establish what is implemented. If two confirmed sources conflict, resolve only the affected behavior through an explicit Decision Record; do not silently invent a rule.

## Active runtime and repository layout

```text
docs/                       normative design, decisions, status, and handoff
packages/contracts/         canonical JSON Schemas (not a workspace package)
packages/rules/             @fable/rules — authoritative headless simulation engine
packages/content/           @fable/content — immutable enemy/intent content catalog
packages/vertical-slice/    @fable/vertical-slice — Player/GM in-memory and WebSocket adapter
dev/                        obsolete examples/scaffolds; not the active runtime
reference/gdd-site/         optional explanatory GDD site; not a normative source
```

The workspace requires Node.js `>=22 <23` and pnpm 11. `packages/rules` owns authoritative gameplay state; the adapter must not duplicate movement, combat, targeting, cards, or outcomes.

## Project invariants

- The server-side engine is authoritative; clients submit intentions, never outcomes.
- Rejected commands do not create gameplay mutations or domain events.
- Visibility is filtered before serialization; a session receives only its own role projection and permitted event fields.
- Preserve deterministic simulation, replay, state-hash parity, and versioned contracts.
- Never add gameplay rules, balance values, production content, or dependencies without an explicit decision and scope.
- Never commit API keys or secrets.

## Current next priority

The current executable Step C subset is documented and tested. Before widening the browser-facing command set or production card/content work, obtain narrow decisions for the unresolved product mechanics in the combat inventory: card taxonomy/magic, hit/miss/critical resolution, and the float-stability/version policy for damage. Keep campaign-wide sequencing and rollback-confirmation design as separate integration gates.
