# Fable — Development Context Repository

This public repository is the canonical context pack for the Fable game project.

## How an AI developer should read this repository

Read in this order:

1. `docs/README.md`
2. `docs/00-product-constitution.md`
3. `docs/01-glossary.md`
4. `docs/02-confirmed-rules.md`
5. `docs/04-step-b-baseline.md`
6. `docs/03-system-contracts.md`
7. `docs/05-vertical-slice.md`
8. `docs/14-step-c-core-engine.md`
9. `packages/contracts/*.json`
10. `docs/12-step-a-repository-and-monorepo.md`
11. `docs/13-ai-task-starter.md`

Markdown contracts and JSON Schemas are the source of truth. `reference/gdd-site/index.html` is only a visual overview.

## Current implementation task

The project is now moving to **Step C — Core Engine & State Machine**. The normative specification is [`docs/14-step-c-core-engine.md`](docs/14-step-c-core-engine.md).

The Step C headless Core Engine lives in `packages/rules` per DR-C-001. Do not implement React, WebSocket transport, PostgreSQL persistence or AI Copilot until the relevant Step C Definition of Done passes.

The first implementation increment is deliberately small:

1. 9×9 grid and collision;
2. `player.move`;
3. 20 Hz clock and 250 ms input windows;
4. deterministic ordering: players → enemies → environment;
5. in-memory event journal and replay;
6. then modes, intents, cards, HP, stamina and statuses.

## Project rules

- The authoritative game state lives on the server.
- A client command is an intention; only the server creates domain events.
- Gameplay rules must not be invented without a Decision Record.
- Visibility is filtered on the backend before serialization.
- `packages/contracts` contains closed discriminated unions with `additionalProperties: false`.
- Never commit API keys or secrets.

## Repository layout

```text
docs/                  normative design and implementation documents
packages/contracts/    JSON Schema contracts
dev/                   existing TypeScript/Drizzle/room examples
reference/gdd-site/    optional visual GDD overview
```

## Starter prompt

Use [`docs/13-ai-task-starter.md`](docs/13-ai-task-starter.md) for the exact prompt and file priority when starting an AI coding session.
