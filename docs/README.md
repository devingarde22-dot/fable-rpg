# Fable — Development Context Pack

Это первый handoff-пакет для AI-разработчика и будущей команды.

## Порядок чтения

Этот порядок полностью совпадает с `README.md` в корне репозитория.

1. [README.md](../README.md)
2. [docs/README.md](./README.md)
3. [Product Constitution](./00-product-constitution.md)
4. [Glossary](./01-glossary.md)
5. [Confirmed Rules](./02-confirmed-rules.md)
6. [System Contracts](./03-system-contracts.md)
7. [Step B Baseline](./04-step-b-baseline.md)
8. [Vertical Slice](./05-vertical-slice.md)
9. [Step C — Core Engine & State Machine](./14-step-c-core-engine.md)
10. [Step A — Repository & Monorepo](./12-step-a-repository-and-monorepo.md)
11. `packages/contracts/*.json`
12. [DR-C-002 — Enemy Registry + Deterministic Intent Simulation](./15-step-c-intent-simulation.md)
13. [DR-C-003 — Deterministic Retreat Resolution](./16-step-c-retreat-resolution.md)
14. [DR-C-004 — HP & Damage Resolution](./18-step-c-hp-damage-resolution.md)
15. [DR-C-005 — Stamina & Resource Regeneration](./19-step-c-stamina-regeneration.md)
16. [DR-C-006 — Minimal Card Play](./20-step-c-card-play.md)
17. [DR-C-007 — Mode-filtered Deck & Timed Hand Rotation](./21-step-c-deck-cycle.md)
18. [DR-C-008 — Status Layers & Immobilized](./22-step-c-status-immobilized.md)
19. [DR-C-009 — Ally Guard Runtime](./23-step-c-ally-guard.md)
20. [Increment 10 — Full Headless Vertical Slice (DR-C-010)](./25-step-c-increment-10-full-headless-slice.md)
21. [Журнал разработки и AI handoff](./17-development-log-and-handoff.md)
22. [Step C audit work log — 2026-10-28](./29-step-c-audit-work-log-2026-10-28.md)
23. [Verified combat-rules inventory](./30-verified-combat-rules-inventory.md)

## Полный каталог документов

В отличие от краткого порядка чтения выше, полный каталог сохраняет все reference, proposal и исторические документы.

1. [Product Constitution](./00-product-constitution.md) — зачем существует Fable и какие принципы нельзя нарушать.
2. [Glossary](./01-glossary.md) — единый смысл терминов.
3. [Confirmed Rules](./02-confirmed-rules.md) — нормативные игровые правила.
4. [System Contracts](./03-system-contracts.md) — команды, события, state machine, visibility и persistence.
5. [Vertical Slice](./05-vertical-slice.md) — конкретная сцена, контент, acceptance criteria и Definition of Done.
6. [Visibility Matrix](./04-visibility-matrix.md) — field-level доступ для TV, Player, GM и AI.
7. [Balance Sheet](./06-balance-sheet.md) — baseline-формулы, числа и late-game tiers.
8. [QA & Acceptance](./07-qa-and-acceptance.md) — golden scenarios, replay, leakage и Definition of Done.
9. [API Specification](./08-api-specification.md) — HTTP, WebSocket, commands, events и Copilot API.
10. [Database Schema](./09-database-schema.md) — PostgreSQL/Drizzle tables, transactions и migrations.
11. [AI Developer Guide](./10-ai-developer-guide.md) — context packets, роли агентов и code review.
12. [Programming Roadmap](./11-programming-roadmap.md) — порядок реализации от simulation до AI.
13. [Step A — Repository & Monorepo](./12-step-a-repository-and-monorepo.md) — подробная настройка пакетов и quality gates.
14. [Step B Reviews](./step-b-reviews/README.md) — результаты reviews по contracts и JSON Schema.
15. [Step B Baseline](./04-step-b-baseline.md) — сведённые решения и закрытые технические вопросы.
16. [AI Task Starter](./13-ai-task-starter.md) — контекст и prompt для задач.
17. [Step C — Core Engine & State Machine](./14-step-c-core-engine.md) — tick loop, scheduler, modes, intents, replay и tests.
18. [DR-C-002 — Enemy Registry + Deterministic Intent Simulation](./15-step-c-intent-simulation.md)
19. [DR-C-003 — Deterministic Retreat Resolution](./16-step-c-retreat-resolution.md)
20. [DR-C-004 — HP & Damage Resolution](./18-step-c-hp-damage-resolution.md)
21. [DR-C-005 — Stamina & Resource Regeneration](./19-step-c-stamina-regeneration.md)
22. [DR-C-006 — Minimal Card Play](./20-step-c-card-play.md)
23. [DR-C-007 — Mode-filtered Deck & Timed Hand Rotation](./21-step-c-deck-cycle.md)
24. [DR-C-008 — Status Layers & Immobilized](./22-step-c-status-immobilized.md)
25. [DR-C-009 — Ally Guard Runtime](./23-step-c-ally-guard.md)
26. [Increment 10 — Full Headless Vertical Slice (DR-C-010)](./25-step-c-increment-10-full-headless-slice.md)
27. [Previous Increment 10 defense-slot proposal](./24-step-c-increment-10-proposal.md) — superseded.
28. [Журнал разработки и AI handoff](./17-development-log-and-handoff.md)
29. [Step C audit work log — 2026-10-28](./29-step-c-audit-work-log-2026-10-28.md)
30. [DR-C-011 — Scene Revision внутри input window](./26-step-c-scene-revision-window-semantics.md)
31. [DR-C-012 — Extinguisher bind uptime](./27-step-c-extinguisher-bind-uptime.md)
32. [Step C read-only audit — historical snapshot](./28-step-c-read-only-audit-2026-10-28.md)
33. [Verified combat-rules inventory](./30-verified-combat-rules-inventory.md)

## Правило использования

AI-разработчик не должен получать только один файл наугад. Для каждой задачи формируется context packet:

```text
Product Constitution
+ Glossary
+ нужный раздел Confirmed Rules
+ нужный System Contract
+ соответствующий Vertical Slice acceptance test
```

После реализации AI обязан вернуть:

- список изменённых файлов;
- тесты;
- какие Rule ID покрыты;
- какие допущения сделаны;
- какие вопросы остались открыты;
- как запускалась проверка.

## Статусы

- `CONFIRMED` — можно реализовывать.
- `PROPOSAL` — нельзя считать каноном без решения.
- `SUPERSEDED` — исторический материал.
- `IMPLEMENTED` — реализовано и принято по acceptance criteria.
- `OPEN_QUESTION` — блокирует однозначную реализацию.

## Первый контекстный пакет

Для первой технической задачи использовать:

```text
docs/00-product-constitution.md
docs/01-glossary.md
docs/02-confirmed-rules.md
docs/03-system-contracts.md
docs/05-vertical-slice.md
```

Аудированный `main` — `7770d04` (PR #18). PR #9–#13 вошли через PR #14; PR #15–#18 также merged. Единственный открытый PR #4 — legacy stacked branch, уже достижимая из `main`. Для текущей реализации и открытых product decisions см. [журнал разработки и AI handoff](./17-development-log-and-handoff.md) и [verified combat-rules inventory](./30-verified-combat-rules-inventory.md).

## Machine-readable contracts

- [Command Schema](../packages/contracts/command.schema.json)
- [Event Schema](../packages/contracts/event.schema.json)
- [Intent Schema](../packages/contracts/intent.schema.json)
- [Visibility Schema](../packages/contracts/visibility.schema.json)
