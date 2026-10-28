# Fable — RPG Engine Repository

`fable-rpg` is the active source repository for Fable. The separate public context pack, [`devingarde22-dot/fable-context`](https://github.com/devingarde22-dot/fable-context), is a synchronized planning aid; it must not override the current code, tests, contracts, or merged Git history here.

## Verified current baseline

The audited `main` baseline is [`7770d04`](https://github.com/devingarde22-dot/fable-rpg/commit/7770d04), the merge commit for PR #18 on 2026-10-28. It contains:

- Step C increments 1–10 and the headless Quarantine Gates vertical slice;
- the PR #9–#13 integration through PR #14;
- the Player/GM WebSocket vertical slice from PR #15;
- role-filtered domain-event projection (PR #16), corrected enemy candidate ranking (PR #17), and authoritative pause/restore/outcome lifecycle work (PR #18).

In the verified maintenance worktree, `pnpm check` passed with **189 tests in 43 files** (6 content, 175 rules, 8 vertical-slice), followed by `pnpm build` and `git diff --check`. The focused vertical-slice regression suite also passed after the role-projection fan-out fix recorded in the current branch.

PR #4 remains open on GitHub, but its head commit `55119c` is already an ancestor of `main`; it is a legacy stacked PR, not pending implementation work. Do not merge it as new work.

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
