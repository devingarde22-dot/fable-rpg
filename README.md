# Fable — RPG Engine Repository

This public repository contains the active Fable codebase. The separate public context pack is [`devingarde22-dot/fable-context`](https://github.com/devingarde22-dot/fable-context); it is a reference for project context, not the code remote. Its overview and reading order predate the current implementation and may lag. For current rules, contracts, code, and implementation status, treat `fable-rpg` as the source of truth.

## How an AI developer should read this repository

Read in this order:

1. `README.md`
2. `docs/README.md`
3. `docs/00-product-constitution.md`
4. `docs/01-glossary.md`
5. `docs/02-confirmed-rules.md`
6. `docs/03-system-contracts.md`
7. `docs/04-step-b-baseline.md`
8. `docs/05-vertical-slice.md`
9. `docs/14-step-c-core-engine.md`
10. `docs/12-step-a-repository-and-monorepo.md`
11. `packages/contracts/*.json`
12. `docs/15-step-c-intent-simulation.md`
13. `docs/16-step-c-retreat-resolution.md`
14. `docs/18-step-c-hp-damage-resolution.md`
15. `docs/19-step-c-stamina-regeneration.md`
16. `docs/20-step-c-card-play.md`
17. `docs/21-step-c-deck-cycle.md`
18. `docs/22-step-c-status-immobilized.md`
19. `docs/23-step-c-ally-guard.md`
20. `docs/25-step-c-increment-10-full-headless-slice.md`
21. `docs/17-development-log-and-handoff.md`

Markdown contracts and JSON Schemas are the source of truth. If a document conflicts with a confirmed rule or schema, stop and report the conflict instead of inventing behavior.

## Current project status

Step C — Core Engine & State Machine increments 1–10 are implemented and merged into `main`. Increment 10 — Full Headless Vertical Slice (DR-C-010) was merged by [PR #8](https://github.com/devingarde22-dot/fable-rpg/pull/8) at merge commit `b619c77` on 2026-10-28. Its full headless Quarantine Gates scenario covers the city-to-scene-to-outcome loop, a 2–4 hero fixture, deterministic replay, rollback, and outcome eligibility. Fresh verification on this commit passed `pnpm check` (164 tests: 5 in `content`, 159 in `rules`) and `pnpm build`.

[PR #9](https://github.com/devingarde22-dot/fable-rpg/pull/9) is an open follow-up for command idempotency hardening: request keys are scoped by session, authenticated actor, and request ID, with saved final results and regression tests. It is separate from the already-merged Increment 10 implementation and awaits review.

The confirmed Increment 10 scope and Definition of Done are documented in [`docs/25-step-c-increment-10-full-headless-slice.md`](docs/25-step-c-increment-10-full-headless-slice.md). The earlier defense-slot-only proposal in [`docs/24-step-c-increment-10-proposal.md`](docs/24-step-c-increment-10-proposal.md) is superseded. See [`docs/17-development-log-and-handoff.md`](docs/17-development-log-and-handoff.md) for implementation history and continuation notes.

## Project rules

- The authoritative game state lives on the server.
- A client command is an intention; only the server creates domain events.
- Gameplay rules must not be invented without a Decision Record.
- Visibility is filtered on the backend before serialization.
- `packages/contracts` contains closed discriminated unions with `additionalProperties: false`.
- Preserve deterministic simulation and exact replay/state-hash parity.
- Never commit API keys or secrets.

## Repository layout

```text
docs/                  normative design, decision records, and implementation handoff
packages/contracts/    JSON Schema contracts
packages/rules/        headless Core Engine and pure rules
packages/content/      validated immutable content catalog
dev/                   existing TypeScript/Drizzle/room examples
reference/gdd-site/    optional visual GDD overview
```

## Starter material

[`docs/13-ai-task-starter.md`](docs/13-ai-task-starter.md) is a reusable starter for an early Step A repository/bootstrap task. For the current implementation state and continuation instructions, read [`docs/17-development-log-and-handoff.md`](docs/17-development-log-and-handoff.md) instead.
