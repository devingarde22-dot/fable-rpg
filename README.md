# Fable — RPG Engine Repository

This public repository contains the active Fable codebase. The separate public context pack is [`devingarde22-dot/fable-context`](https://github.com/devingarde22-dot/fable-context); use it for project context, not as the code remote.

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
20. `docs/17-development-log-and-handoff.md`

Markdown contracts and JSON Schemas are the source of truth. If a document conflicts with a confirmed rule or schema, stop and report the conflict instead of inventing behavior.

## Current project status

Step C — Core Engine & State Machine increments 1–9 are implemented and merged into `main`. The latest accepted increment is **Increment 9 — Ally Guard Runtime (DR-C-009)**, merged by PR [#7](https://github.com/devingarde22-dot/fable-rpg/pull/7) at commit `6423c19` on 2026-10-27. Increments 5–7 are also present in `main` through PR [#6](https://github.com/devingarde22-dot/fable-rpg/pull/6), which includes their ancestry. Earlier milestones were merged through PR [#1](https://github.com/devingarde22-dot/fable-rpg/pull/1) (increments 1–3) and PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) (Increment 4).

The headless Core Engine lives in `packages/rules` per DR-C-001. The current implementation includes deterministic movement, enemy intents, combat and damage resolution, stamina regeneration, card/deck handling, status layers, Ally Guard, event journaling and replay. Increment 9 activates the existing `extinguisher` intents supported by the implemented status handlers; it does not add or rebalance production content.

An unconfirmed, non-binding Increment 10 scope candidate for the defense-card slot is documented in [`docs/24-step-c-increment-10-proposal.md`](docs/24-step-c-increment-10-proposal.md). No Increment 10 scope or DR-C-010 has been confirmed. Do not infer or invent gameplay behavior; implementation must wait for explicit user approval of the scope and its open rules.

The current implementation details, verification results and continuation constraints are summarized in [`docs/17-development-log-and-handoff.md`](docs/17-development-log-and-handoff.md). Note: when handoff text and live GitHub state differ, verify the current branch/PR state; PR #7 has been merged to `main`.

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
