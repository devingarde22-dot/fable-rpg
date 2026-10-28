# Increment 10 — Full Headless Vertical Slice (DR-C-010)

**Статус:** `IMPLEMENTED / VERIFIED; MERGED TO main via PR #8`
**Репозиторий:** `fable-rpg`; Increment 10 merged at `b619c77`. Рабочая ветка исходной реализации — `feat/full-headless-vertical-slice`.
**Основание:** согласованный пользователем план Increment 10 и ответы в сессии 2026-10-28.

## Цель и границы

Довести `packages/rules` до полного headless vertical slice на Quarantine Gates: grid и движение, enemy intents, hero modes и retreat, HP/damage, stamina, test-only cards, statuses, Extinguisher, append-only journal, replay/rollback, party fixture на 2–4 героев и outcomes. Это только in-memory engine/campaign loop: PostgreSQL, UI, сеть и production card catalog не входят в Increment 10. Каждое посещение города создаёт новый in-memory city-save checkpoint.

```text
city → route → node → scene → GM-confirmed outcome → city checkpoint
```

## Подтверждённые решения

- Один actor владеет ровно одним hero; reference fixture использует 4 стартовые клетки и поддерживает 2–4 heroes. Старая fixture с двумя стартовыми клетками устарела.
- Карты Increment 10 — только `TEST_ONLY / NON_BALANCE`; production catalog не расширяется. Сохраняются обычные карты и добавляется один отдельный defense slot на героя. Защитная карта имеет test cost 1, оплачивается по обычному правилу stamina, после игры уходит в discard; draw/refill не выполняется.
- Test-only защита покрывает три формы: 100%-ный блок одной атаки; конечный barrier, расходуемый до нуля; status buff на себя или союзника. Barrier/защитные слои исчезают при завершении сцены. Урок/баланс карт не утверждается.
- `reposition` остаётся `DEFERRED` и не входит в Definition of Done.
- Extinguisher выбирает первый подходящий вариант в порядке `bind → ally_guard → move_close → hold_position`. Явно заданный initial intent может использоваться как fixture/GM override; в обычном выборе применяется runtime eligibility.
- Outcome подтверждает GM через server-side engine API; engine проверяет eligibility. `success` требует, чтобы все enemies были удалены, и отмечает reward unlocked, но reward items не выдаются. `retreat` допустим в любой момент, возвращает к последнему city-save, оставляет node повторяемым и блокирует reward. `defeat` требует, чтобы все heroes были critically injured; node закрывается, повтор разрешён, reward закрыт. `gm_abort` закрывает сцену технически, reward закрыт без отдельного подтверждённого consequence.
- Если после последнего убийства одновременно выполнены условия success и defeat, outcome выбирает GM вручную; engine не вводит приоритет одного результата.
- Checkpoint/rollback только in-memory. Rollback восстанавливает checkpoint state, сохраняет всю прежнюю journal history, добавляет rollback event, поддерживает монотонные `serverSequence`/`sceneRevision` и возвращает новый snapshot. Persistence/DB и удаление replay history не реализуются.

## Definition of Done

- Все перечисленные игровые подсистемы работают последовательно в headless Quarantine Gates fixture.
- Fixture детерминирована при фиксированном seed и проходит с 2, 3 и 4 героями; один actor не может владеть несколькими heroes.
- Отдельные tests покрывают карты защиты, stamina cost/discard, блок/истощение barrier, ally/self status, истечение защиты в конце сцены, rollback/replay parity и monotonic counters.
- Extinguisher priority chain и сценарий Quarantine Gates проверяются fixed-seed test-ом.
- `success`, `retreat`, `defeat`, `gm_abort` имеют серверные eligibility checks и проверенное replay-поведение.
- Contracts, typecheck, lint, tests, build и `git diff --check` проходят.

## Реализация / известные ограничения

Никакого внешнего command transport не добавляется: ручное GM-подтверждение представлено server-side методом `SimulationEngine.confirmOutcome`. In-memory campaign wrapper управляет city/route/node/scene метаданными и сохраняет city checkpoints. Scene transfer между разными движками и награды-предметы остаются вне Increment 10.

Проверка реализации на merge commit: `pnpm check` — PASS (164 tests: 5 в `content`, 159 в `rules`; 36 rules test files); `pnpm build` — PASS для обоих пакетов. Отдельно проверены JSON Schema parse, `git diff --check`, barrier cleanup в конце сцены, self-target Ally Guard и defeat replay parity. Golden-сценарий Quarantine Gates с четырьмя героями проходит полный цикл `city → route → node → scene → success → city checkpoint`, повторяется детерминированно и совпадает с journal replay по state hash. [PR #8](https://github.com/devingarde22-dot/fable-rpg/pull/8) слит в `main`; последующий idempotency audit был интегрирован PR #14. Current main и актуальные результаты проверки отражены в [handoff](./17-development-log-and-handoff.md).

## Источники

- [Vertical Slice — Quarantine Gates](./05-vertical-slice.md)
- [Step C Core Engine](./14-step-c-core-engine.md)
- [Increment 10 defense-slot proposal (superseded)](./24-step-c-increment-10-proposal.md)
