# Fable — Development Context Pack

Это первый handoff-пакет для AI-разработчика и будущей команды.

## Порядок чтения

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
13. [Step A — Repository & Monorepo](./12-step-a-repository-and-monorepo.md) — подробная настройка репозитория, пакетов и quality gates.
14. [Step B Reviews](./step-b-reviews/README.md) — результаты шести агентов по contracts и JSON Schema.
15. [Step B Baseline](./04-step-b-baseline.md) — сведённые решения и закрытые технические вопросы.
16. [AI Task Starter](./13-ai-task-starter.md) — что загрузить AI-разработчику и готовый prompt.
17. [Step C — Core Engine & State Machine](./14-step-c-core-engine.md) — серверные сущности, tick loop, scheduler, режимы, intents, replay и acceptance tests.
18. [DR-C-002 — Enemy Registry + Deterministic Intent Simulation](./15-step-c-intent-simulation.md) — подтверждённая схема intent, активный enemy roster, timers, RNG, fallback и golden replay requirements.
19. [DR-C-003 — Deterministic Retreat Resolution](./16-step-c-retreat-resolution.md) — retreat attacks, mode/contact transitions and replay.
20. [DR-C-004 — HP & Damage Resolution](./18-step-c-hp-damage-resolution.md) — единый урон, HP=0, removal events, версии hp.changed и replay.
21. [DR-C-005 — Stamina & Resource Regeneration](./19-step-c-stamina-regeneration.md) — стартовый ресурс, tick-based regeneration, cap behavior, replay и scope.
22. [Журнал разработки и AI handoff](./17-development-log-and-handoff.md) — repository routing, выполненные инкременты, DR, тесты и правила продолжения.

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

Step C increments 1–4 реализованы и приняты. PR [#1](https://github.com/devingarde22-dot/fable-rpg/pull/1) (increments 1–3) и PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) (Increment 4 / DR-C-004) слиты в `main`; PR #2 слит 2026-10-27 (merge commit `9e0d0f8`). Increment 5 / DR-C-005 реализуется в feature branch `step-c-increment-5-stamina` и пока не слит. Не начинать дальнейшие increments без отдельного запроса пользователя и предварительно одобренного плана. См. [журнал разработки и AI handoff](./17-development-log-and-handoff.md).

## Machine-readable contracts

- [Command Schema](../packages/contracts/command.schema.json)
- [Event Schema](../packages/contracts/event.schema.json)
- [Intent Schema](../packages/contracts/intent.schema.json)
- [Visibility Schema](../packages/contracts/visibility.schema.json)
