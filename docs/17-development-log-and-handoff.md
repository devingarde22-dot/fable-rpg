# Fable — журнал разработки и handoff для AI

**Обновлено:** 2026-10-27 (после merge PR #2)
**Статус:** Step C, Increment 1–4 приняты и слиты в `fable-rpg/main`. PR [#1](https://github.com/devingarde22-dot/fable-rpg/pull/1) содержал increments 1–3; PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) с Increment 4 (DR-C-004) слит 2026-10-27. Merge commit: `9e0d0f8`.

Этот документ — краткая карта проекта для продолжения работы другой нейросетью. Он не заменяет нормативные документы и не вводит новых игровых правил. При любом расхождении приоритет имеют подтверждённые документы `docs/` и машинно-читаемые контракты.

## 1. Текущий статус и ближайшее действие

- Репозиторий кода: [`devingarde22-dot/fable-rpg`](https://github.com/devingarde22-dot/fable-rpg). Step C engine находится в `packages/rules` согласно DR-C-001.
- Репозиторий `fable-context` — отдельный публичный context pack для передачи Markdown-документов и проектного контекста, не целевой репозиторий для изменений кода.
- Step C Increment 1 (grid/movement), Increment 2 (enemy registry/intents) и Increment 3 (hero modes/contact/retreat) завершены и приняты. PR #1 слит 2026-10-27.
- Текущая ветка `step-c-headless-core` уже вошла в `fable-rpg/main`. Merge commit PR #1: `a9b07d6aeca48e26993b8b02b13e3520b934a41e`.
- Increment 4 (HP & Damage Resolution) закоммичен как `4d26a18` (`feat(rules): add HP and damage resolution`) в ветке `step-c-increment-4-hp-damage`; PR #2 слит в `main` 2026-10-27. Merge commit: `9e0d0f8` (`9e0d0f8996816f7d00c4521bbf6ad30382bfb74e`).
- Increment 4 принят. Не начинать Increment 5 или иные новые gameplay changes без отдельного запроса пользователя; для новой игровой задачи сначала подготовить PLAN и дождаться явного одобрения.

### Маршрутизация репозиториев

- Все изменения исходного кода и PR направлять в `fable-rpg`.
- `fable-context` использовать как context pack, а не как code remote.
- Из-за прежней ошибки маршрутизации в `fable-context` осталась одноимённая ветка `step-c-headless-core` на commit `e866c6f`. Это дубликат; она не является целевой веткой разработки. Не обновлять и не удалять её без отдельного указания пользователя.
- Feature branch `step-c-increment-4-hp-damage` и её upstream содержали Increment 4; изменения вошли в `main` через PR #2. Для будущих изменений кода и docs использовать `fable-rpg`, не `fable-context`.

## 2. Порядок чтения источников истины

Перед новой задачей прочитать в следующем порядке:

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

Для текущей реализации дополнительно прочитать `docs/15-step-c-intent-simulation.md`, `docs/16-step-c-retreat-resolution.md`, `docs/18-step-c-hp-damage-resolution.md` и этот handoff. Не переносить устаревшие инструкции из `docs/13-ai-task-starter.md` как текущий план: он описывает starter для раннего Step A.

**Правило:** не изобретать gameplay rules. Если подтверждённые документы противоречат друг другу или коду, остановиться, указать Rule ID и файлы и вынести вопрос пользователю/в Decision Record.

## 3. Журнал разработки

| Commit | Этап / результат |
|---|---|
| `3e9ab7d` — `feat(rules): add headless grid movement engine` | Increment 1: TypeScript monorepo и headless engine; grid 9×9, terrain/collision, `player.move`, tick/window scheduler, порядок фаз, revision, journal и replay. |
| `e99cc29` — `feat(rules): update DR-C-001 and refinement tests for rejected command semantics` | Зафиксирован DR-C-001 и уточнено: rejected command не мутирует gameplay state, `sceneRevision` или domain journal; authoritative `serverTick` и scheduler bookkeeping могут продолжаться. |
| `06671eb` — `feat(rules): add deterministic enemy intent simulation` | Increment 2: enemy registry, active intent lifecycle, deterministic target/fallback behavior, versioned RNG, journal replay и golden transcript. |
| `e866c6f` — `feat(rules): add hero modes and retreat resolution` | Increment 3: hero modes, contact detection, contact immunity, retreat attacks и точный replay. |
| `85745e5` — `merge: connect fable-rpg main history` | Технический merge commit для соединения feature branch с первоначальной историей `fable-rpg/main`, в которой был только `LICENSE`; игрового кода не меняет. |
| `a9b07d6` — GitHub merge commit PR #1 | PR #1 слит в `fable-rpg/main`. |
| `4d26a18` — `feat(rules): add HP and damage resolution` | Increment 4: единый `fable.damage.v1` pipeline; `hp.changed` v2 и replay-совместимость с v1; enemy cleanup/removal; регрессии и DR-C-004. Слито в `main` через PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) 2026-10-27; merge commit `9e0d0f8`. |

PR [#1](https://github.com/devingarde22-dot/fable-rpg/pull/1) включал Increment 1–3 и DR-C-001–003; PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) включал Increment 4 и DR-C-004. Оба PR слиты в `main`.

## 4. Архитектура и инварианты

- Monorepo: TypeScript strict mode, Node.js 22, pnpm workspace.
- `packages/rules` (`@fable/rules`) — headless Core Engine: runtime state, `SimulationEngine`, grid/movement, clock, scheduler, intents, combat mode/contact logic, unified damage/HP pipeline, cleanup, append-only in-memory journal и replay.
- `packages/content` (`@fable/content`) — immutable enemy/intent content catalog.
- `packages/contracts` — canonical JSON Schemas; не добавлять дублирующие wire fields без Decision Record.
- Engine не зависит от UI, WebSocket/Colyseus, базы данных или сети.
- Grid — 9×9; logical clock — 20 Hz, один tick = 50 ms; input window — 5 ticks = 250 ms.
- Batch phase order: `players → enemies → environment`.
- Только authoritative engine меняет runtime state. Rejected command не меняет gameplay state, `sceneRevision` или domain journal; tick/window bookkeeping может продвинуться. Duplicate `requestId` не создаёт повторную gameplay mutation/event.
- Одинаковые initial state, content/rules versions, command sequence и seed должны давать одинаковые события и `stateHash`. В gameplay logic запрещены `Math.random()` и wall-clock API вроде `Date.now()`.
- Replay должен давать точное состояние и тот же `stateHash`, а не приблизительное восстановление.

## 5. Реализованные инкременты

### Increment 1 — Grid and Movement

- Grid 9×9; клетки `floor`, `wall`, `statue`/barrier; координаты, границы и occupied cells.
- Authoritative `player.move` принимает direction (`up`, `down`, `left`, `right`); destination вычисляет server.
- Блокируются выход за границы, стены/статуи и занятые клетки (герой или враг). Конкурирующие команды за одну клетку обрабатываются детерминированно.
- 20 Hz logical tick, 250 ms input windows, порядок фаз players → enemies → environment, `sceneRevision`, append-only in-memory journal и replay.

### Increment 2 — Enemy Registry and Deterministic Intents (DR-C-002)

- В content catalog зарегистрированы `quarantine_chaser`, `slag_shooter`, `extinguisher`.
- Активные runtime handlers: `quarantine_chaser` — `move_close`, `melee_strike`, `hold_position`; `slag_shooter` — `ranged_shot`, `hold_position`.
- `extinguisher` остаётся catalog-only до реализации `bind` и `ally_guard`; `reposition` deferred/draft и не должен быть активным handler или fallback.
- Intent timers работают по ticks; wire contract использует только `durationMs`, из которого engine выводит `durationTicks = durationMs / 50`. Требования: `durationMs >= 3000` и `durationMs % 50 === 0`.
- Mapping schema: `conditions` → preconditions; `targetRules` → target policy/range/LoS/filters; `effect` → typed handler и параметры; `fallbackKeys` → ordered fallback list.
- Реализованы детерминированный target selection, fallback, handlers `move_close`, `melee_strike`, `ranged_shot`, `hold_position`, события intent lifecycle и exact replay.
- Golden transcript покрывает 120 ticks; replay tests проверяют точное совпадение live/replay state и hash.

### Increment 3 — Hero Modes, Contact and Retreat (DR-C-003)

- Команды: `player.enter_movement_mode`, `player.enter_ranged_mode`.
- Ranged-mode gate — authoritative `hero.canEnterRangedMode === true`; это capability flag, а не реализация карт.
- Automatic melee contact использует Chebyshev distance 1, включая диагональ.
- После melee retreat действует immunity 300 ticks (15 секунд): блокировка контакта, пока `serverTick < contactImmunityUntilTick`.
- Retreat разрешает по одной immediate basic attack от каждого eligible enemy в контакте, сортировка строго по `enemyId` ascending; attack order `i` получает коэффициент `1/i`.
- Retreat damage: `mitigation = 100/(100+heroDefense)`, `mitigatedDamage = ceil(rawDamage*mitigation)`, `finalDamage = ceil(mitigatedDamage*coefficient)`. HP не ниже 0. Нет crit, miss, status или stun; все атаки разрешаются даже после достижения 0 HP. `hp.changed` создаётся только при реальном изменении HP.
- Retreat batch — одна event group и один `sceneRevision`; same-tick enemy intents продолжаются через обычный scheduler/preconditions. Replay восстанавливает mode, HP, immunity, event group и hash.
- Basic attacks: `quarantine_chaser` 140 raw damage; `slag_shooter` 100; `extinguisher` 100.

### Increment 4 — HP & Damage Resolution (DR-C-004; PR #2 merged)

- Общий `fable.damage.v1` formula: `mitigation = 100/(100+defense)`, `mitigatedDamage = ceil(rawDamage*mitigation)`, `finalDamage = ceil(mitigatedDamage*multiplier)`; multiplier не округляется.
- `melee_strike`, `ranged_shot` и retreat basic attacks используют один `applyDamage` pipeline; карты/колоды не добавлены.
- Hero HP 0 → `critically_injured` и gameplay actions отвергаются; enemy HP 0 сразу исключён из targets/intents, затем cleanup выставляет `removed` и освобождает клетку.
- Новые damage events — `hp.changed` v2 с source/formula inputs/result; v1 остаётся replay-compatible. `scene.entity_removed` v1 и `intent.cancelled(owner_removed)` воспроизводят enemy cleanup.
- Проверяется одна revision/event group на damage batch и полный live/replay snapshot + stateHash parity.

## 6. Decision Records

- **DR-C-001 — CONFIRMED:** Step C engine располагается в `packages/rules`. Причина — согласованный scope и меньшая сложность vertical slice. `packages/simulation` может быть будущей опцией, но перенос сейчас запрещён.
- **DR-C-002 — CONFIRMED:** схема intents, active roster, timer semantics, target/fallback behavior и deterministic RNG описаны в `docs/15-step-c-intent-simulation.md`.
- **DR-C-003 — CONFIRMED:** retreat coefficient, attack order, damage rounding, immunity, event ordering и replay описаны в `docs/16-step-c-retreat-resolution.md`.
- **DR-C-004 — CONFIRMED:** единый HP/damage pipeline, формула `fable.damage.v1`, `hp.changed` v2, enemy removal event, event ordering и replay описаны в `docs/18-step-c-hp-damage-resolution.md`.
- Canonical RNG name: `xoshiro128**`; `algorithmVersion = fable.rng.v1`. `xoshiro128ss` — только внутренний shorthand. Seed encoding — UTF-8; fork seed — SHA-256 компактной canonical JSON array из `rootSeed`, `campaignId`, `sceneId`, `serverTick`, `activeIntentId`, `purpose`. Retreat order не использует RNG; активные purposes включают `target_selection`, `fallback_selection`, `deck_shuffle`.

## 7. Последние проверки

Для Increment 4 (2026-10-27; ветка `step-c-increment-4-hp-damage`, PR #2 слит в `main`):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite.
- `pnpm build` — PASS: `@fable/content` и `@fable/rules`.
- Тесты: **78 passed** — 5 в `content` и 73 в `rules`, 18 test files суммарно.
- Все 5 canonical JSON Schemas проходят Ajv 2020 compilation; `git diff --check` проходит.
- В новой damage/cleanup gameplay logic нет `Math.random()`/`Date.now()`; HP mutations находятся в damage pipeline и replay reducer.
- `pnpm install --frozen-lockfile` был проверен в предыдущем Step C acceptance; повторять при изменении lockfile/dependencies.

При любом новом изменении повторно запустить как минимум `pnpm check` и `pnpm build`, затем сообщить точные результаты. Increment 4 принят и слит через PR #2; не начинать следующий increment без отдельного запроса пользователя и предварительно одобренного плана.

## 8. Что ещё не реализовано / ограничения scope

Не считать готовыми или не начинать без отдельного плана и подтверждения: cards/card play, stamina, UI (TV/Player/GM), WebSocket/Colyseus networking, PostgreSQL/persistence, authentication, deployment, AI Copilot, полный combat system, новые карты/сцены и остальные статусы.

В частности, `extinguisher` ещё не активен в runtime; `bind`, `ally_guard` и `reposition` не реализованы как active handlers. Не расширять scope молча.

## 9. Инструкция следующему AI

1. Убедиться, что открыт репозиторий `fable-rpg`, ветка и `git status` соответствуют задаче; `fable-context` — context pack, не code target.
2. Прочитать normative документы в порядке выше и соответствующие Decision Records/JSON Schemas.
3. Для новой игровой функции вернуть PLAN с файлами, API/state changes, детерминизмом/replay, тестами, допущениями и вопросами. Не писать код до явного одобрения плана.
4. Не начинать следующий increment по собственной инициативе и не менять уже принятые правила без Decision Record.
5. Сохранять deterministic replay, state hash parity, строгую валидацию contracts и чистое разделение headless rules от UI/network/database.
6. Для code changes использовать feature branch в `fable-rpg`, проверять diff/status, не force-push и открывать PR только по просьбе пользователя.
