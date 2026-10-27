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
15. `docs/17-development-log-and-handoff.md`

Markdown contracts and JSON Schemas are the source of truth. If a document conflicts with a confirmed rule or schema, stop and report the conflict instead of inventing behavior.

## Current project status

Step C increments 1–3 are implemented and accepted. PR [#1](https://github.com/devingarde22-dot/fable-rpg/pull/1) has been merged to `main`. Increment 4 (HP & Damage Resolution, DR-C-004) is committed and published on `step-c-increment-4-hp-damage`; PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) is open and awaits review/merge. The current implementation and continuation constraints are summarized in [`docs/17-development-log-and-handoff.md`](docs/17-development-log-and-handoff.md).

The headless Core Engine lives in `packages/rules` per DR-C-001. Do not begin Increment 5 or other new gameplay work until the user accepts Increment 4 and requests the next step. For any later gameplay work, prepare a PLAN first and wait for explicit approval before implementation.

## Project rules

- The authoritative game state lives on the server.
- A client command is an intention; only the server creates domain events.
- Gameplay rules must not be invented without a Decision Record.
- Visibility is filtered on the backend before serialization.
- `packages/contracts` contains closed discriminated unions with `additionalProperties: false`.
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
