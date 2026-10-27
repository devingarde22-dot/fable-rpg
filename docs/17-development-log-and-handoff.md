# Fable — журнал разработки и handoff для AI

**Обновлено:** 2026-10-27 (Increment 9 implemented and verified locally; not committed or opened as PR)
**Статус:** Increment 1–8 находятся в `fable-rpg/main` (merge commit PR #6: `4b9336c`). PR #3–#5 для increments 5–7 остаются открытыми, хотя их commits вошли в main через PR #6. Increment 9 / DR-C-009 реализован в feature branch `step-c-increment-9-ally-guard`; `pnpm check` и `pnpm build` прошли, изменения ещё не закоммичены и PR не открыт. PR #1–#2 — исторические merges; актуальные детали приведены ниже.

Этот документ — краткая карта проекта для продолжения работы другой нейросетью. Он не заменяет нормативные документы и не вводит новых игровых правил. При любом расхождении приоритет имеют подтверждённые документы `docs/` и машинно-читаемые контракты.

## 1. Текущий статус и ближайшее действие

- Репозиторий кода: [`devingarde22-dot/fable-rpg`](https://github.com/devingarde22-dot/fable-rpg). Step C engine находится в `packages/rules` согласно DR-C-001.
- Репозиторий `fable-context` — отдельный публичный context pack для передачи Markdown-документов и проектного контекста, не целевой репозиторий для изменений кода.
- Step C Increment 1 (grid/movement), Increment 2 (enemy registry/intents) и Increment 3 (hero modes/contact/retreat) завершены и приняты. PR #1 слит 2026-10-27.
- Историческая feature branch `step-c-headless-core` вошла в `fable-rpg/main`. Merge commit PR #1: `a9b07d6aeca48e26993b8b02b13e3520b934a41e`.
- Increment 4 (HP & Damage Resolution) закоммичен как `4d26a18` (`feat(rules): add HP and damage resolution`) в ветке `step-c-increment-4-hp-damage`; PR #2 слит в `main` 2026-10-27. Merge commit: `9e0d0f8` (`9e0d0f8996816f7d00c4521bbf6ad30382bfb74e`).
- Increment 5 (Stamina & Resource Regeneration) реализован commit `d237616` в ветке `step-c-increment-5-stamina`; PR [#3](https://github.com/devingarde22-dot/fable-rpg/pull/3) открыт и ждёт review/merge.
- Increment 6 (Minimal Card Play) реализован в commit `946b557` на ветке `step-c-increment-6-card-play`; PR [#4](https://github.com/devingarde22-dot/fable-rpg/pull/4) открыт как stacked PR поверх PR #3. Текущий scope и правила — [DR-C-006](./20-step-c-card-play.md).
- Increment 7 (Mode-filtered Deck & Timed Hand Rotation) реализован в commit `f175a1b` и опубликован в PR [#5](https://github.com/devingarde22-dot/fable-rpg/pull/5). Подтверждённые правила — [DR-C-007](./21-step-c-deck-cycle.md).
- Increment 8 (Status Layers & Immobilized) реализован в commit `24ca60e` и опубликован в PR [#6](https://github.com/devingarde22-dot/fable-rpg/pull/6) в `main`; PR включает ancestry increments 5–7. Правила и typed-layer contracts — [DR-C-008](./22-step-c-status-immobilized.md).
- Increment 9 (Ally Guard Runtime) реализован локально в `step-c-increment-9-ally-guard`; `pnpm check` и `pnpm build` проходят. Изменения пока не закоммичены и не опубликованы; правила — [DR-C-009](./23-step-c-ally-guard.md).

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

Для текущей реализации дополнительно прочитать `docs/15-step-c-intent-simulation.md`, `docs/16-step-c-retreat-resolution.md`, `docs/18-step-c-hp-damage-resolution.md`, `docs/19-step-c-stamina-regeneration.md`, `docs/20-step-c-card-play.md` и этот handoff. Не переносить устаревшие инструкции из `docs/13-ai-task-starter.md` как текущий план: он описывает starter для раннего Step A.

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
| `d237616` — `feat(rules): add stamina regeneration` | Increment 5: max из config/preset, start=3, tick timer/300, timer stop at cap, `stamina.changed`, resource phase, pure affordability helper, replay/stateHash и DR-C-005. Ветка `step-c-increment-5-stamina`; PR [#3](https://github.com/devingarde22-dot/fable-rpg/pull/3) открыт. |
| `946b557` — `feat(rules): implement minimal card play` | Increment 6 / DR-C-006; PR [#4](https://github.com/devingarde22-dot/fable-rpg/pull/4) открыт как stacked PR. |
| `f175a1b` — `feat(rules): add mode-filtered deck cycle` | Increment 7 / DR-C-007; PR [#5](https://github.com/devingarde22-dot/fable-rpg/pull/5) открыт. |
| `24ca60e` — `feat(rules): implement immobilized status lifecycle` | Increment 8 / DR-C-008: typed status layers, test-backed bind/immobilized, refresh/expiry/replay; опубликован в PR [#6](https://github.com/devingarde22-dot/fable-rpg/pull/6) в `main`. |
| — (локально, без commit) | Increment 9 / DR-C-009: Ally Guard, активный Extinguisher handler, replay/schema/golden transcript; `pnpm check` и `pnpm build` прошли на ветке `step-c-increment-9-ally-guard`. |

PR [#1](https://github.com/devingarde22-dot/fable-rpg/pull/1) включал Increment 1–3 и DR-C-001–003; PR [#2](https://github.com/devingarde22-dot/fable-rpg/pull/2) включал Increment 4 и DR-C-004 и слит в `main`; PR [#6](https://github.com/devingarde22-dot/fable-rpg/pull/6) также слит в `main` и содержит ancestry increments 5–7. PR [#3](https://github.com/devingarde22-dot/fable-rpg/pull/3), [#4](https://github.com/devingarde22-dot/fable-rpg/pull/4) и [#5](https://github.com/devingarde22-dot/fable-rpg/pull/5) остаются открытыми, хотя их commits включены в main через PR #6. Для Increment 9 commit/PR пока не создавались.

## 4. Архитектура и инварианты

- Monorepo: TypeScript strict mode, Node.js 22, pnpm workspace.
- `packages/rules` (`@fable/rules`) — headless Core Engine: runtime state, `SimulationEngine`, grid/movement, clock, scheduler, intents, combat mode/contact logic, typed status layers, unified damage/HP pipeline, cleanup, append-only in-memory journal и replay.
- `packages/content` (`@fable/content`) — immutable enemy/intent content catalog.
- `packages/contracts` — canonical JSON Schemas; не добавлять дублирующие wire fields без Decision Record.
- Engine не зависит от UI, WebSocket/Colyseus, базы данных или сети.
- Grid — 9×9; logical clock — 20 Hz, один tick = 50 ms; input window — 5 ticks = 250 ms.
- Batch phase order: `players → enemies → environment → resources → cards → statuses`; stamina regeneration runs in resources, deck rotation in cards, and due status expiration in the final status phase.
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
- Increment 8 активировал `bind` для `immobilized`; Increment 9 активировал существующие `extinguisher` handlers `bind`, `ally_guard` и `move_close` после реализации обоих status effects. Новые production templates/значения не добавлялись; `reposition` остаётся deferred/draft и не является active handler или fallback.
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

### Increment 5 — Stamina & Resource Regeneration (DR-C-005; commit `d237616`, not merged)

- Hero начинает с 3 stamina; `stamina.max` передаётся через config/preset и должен быть не меньше 3. Fixtures используют max 3.
- Регенерация +1 каждые 300 authoritative ticks. Timer хранит `nextRegenAtTick`, становится `null` при полном запасе и для неактивного героя; пропущенные восстановления не копятся.
- Movement/melee/ranged modes не блокируют регенерацию. Переход к HP=0/`critically_injured` останавливает timer; stamina не меняет HP.
- `stamina.changed` создаётся только при фактическом восстановлении; heroes обрабатываются по ID в ресурсной фазе после environment. Replay валидирует due tick и +1; `stateHash` включает текущий ресурс и timer.
- `canAffordStamina` покрывает нулевую стоимость при нуле и отказ при нехватке; расходующие actions/cards не реализуются.
- Scene pause не реализуется, хотя pause JSON Schemas существуют; pause runtime остаётся отдельной задачей.

### Increment 6 — Minimal Card Play (DR-C-006; commit `946b557`; PR #4 open)

- Реализован только `player.play_card` для instance, уже находящегося в hand: проверки активного героя/HP, card revision, режима, цели/HP, range/LoS и affordability; один прямой урон через `fable.damage.v1`; hand→discard и увеличение card revision.
- Positive cost списывает stamina и задаёт `nextRegenAtTick = serverTick + 300`; cost `0` разрешён при `0` stamina и не создаёт `stamina.changed` только за cost. Rejected play не создаёт игровых событий/мутаций.
- Replay проверяет последовательность `card.played` → optional `stamina.changed(card_cost)` → card-source `hp.changed` v2 → `card.discarded`; canonical hash включает card containers/revision.
- Используются исключительно fixtures `TEST_ONLY / NON_BALANCE`; production catalog не создавался. `card.discarded` event schema добавлена, command schema не менялась.
- Mode-entry draw и timer-driven reshuffle реализованы в Increment 7; defense slot, production card catalog/balance, statuses, UI, WebSocket, PostgreSQL и AI не входят в scope.

### Increment 7 — Mode-filtered Deck & Timed Hand Rotation (DR-C-007; commit `f175a1b`; PR #5 open)

- Каждый вход/переход в `melee`/`ranged` заново фильтрует все card instances по `allowedModes`, сортирует вход и детерминированно shuffle/deal до пяти карт; mode-neutral fixtures допустимы в обоих режимах. Используются только `TEST_ONLY / NON_BALANCE` templates.
- Rotation timer задаётся при боевом входе на `entryTick + 300`, сохраняется на `melee ↔ ranged`, очищается при выходе в movement. Каждые 300 ticks карта справа у полной руки идёт в discard, новая карта приходит слева; короткая рука не сбрасывается. Play не вызывает immediate draw.
- Discard reshuffle делается только когда draw pile пуст; при полной руке только что сброшенная карта уже участвует в shuffle. Пустой пул даёт replayable no-card outcome и двигает deadline.
- События `deck.shuffled`, `card.drawn`, `card.discarded(timer_rotation)` и `deck.rotation_resolved` валидируются replay reducer-ом; RNG audit, card containers, revision и rotation deadline участвуют в replay/stateHash parity.

### Increment 8 — Status Layers & Immobilized (DR-C-008; implemented and verified locally)

- Текущая ветка `step-c-increment-8-immobilized` ответвлена от опубликованного Increment 7 commit `f175a1b`; PR/commit для Increment 8 не создавались.
- `EntityRuntime.statuses` использует тип `StatusLayer[]`: `id`, `templateKey`, nullable `sourceEntityId`, `potency`, `stacks`, `appliedAtTick`, `expiresAtTick`, `refreshPolicy`. В этом scope разрешён только `immobilized`, один stack и `refresh_duration`.
- `createRuntimeState` клонирует initial status objects для hero/enemy и проверяет shape; runtime invariants проверяют source references, уникальность layer IDs и tick/policy rules; `cloneRuntimeState` делает deep copy.
- `bind` накладывает `immobilized` длительностью 300 ticks. Refresh сохраняет layer ID/source/potency/stacks, обновляет application tick и срок на `refreshTick + 300`; additive stacking не включён. Только test fixture templates используют bind.
- `player.move` отклоняется с `ENTITY_UNABLE_TO_ACT`; status expires after gameplay phases at due tick, sorted by entity ID/layer ID. `status.applied/refreshed/expired`, replay reducer and canonical stateHash support added.
- Тесты специфицируют valid/invalid layer initialization, deep copy, refresh before/on expiry, exact due tick behavior, deterministic expiration order, blocked movement, event schema and event/journal replay parity. UI, other statuses, status cards and production catalog remain out of scope.

### Increment 9 — Ally Guard Runtime (DR-C-009; implemented and verified locally)

- Использован только существующий content: без новых enemy/intent templates и изменений balance values. Runtime registry активирует `extinguisher` intents `bind`, `ally_guard`, `move_close`; `reposition` остаётся deferred.
- `ally_guard` даёт `effectiveDefense = baseDefense * 1.20` без промежуточного округления; базовая defense не меняется. Refresh сохраняет layer ID/source/potency/stacks, обновляя `appliedAtTick` и deadline на 300 ticks от нового применения.
- Canonical status schemas и replay reducer проверяют apply/refresh/expiry и `hp.changed` defense, включая отказ на tampered defense и omitted status event. Golden intent transcript обновлён существующим Extinguisher intent; replay/stateHash parity покрыта.
- `pnpm check` — PASS (5 content + 142 rules tests, 33 rules test files); `pnpm build` — PASS; final focused Ally Guard/replay/schema regressions — 12 passed; `git diff --check` и JSON Schema syntax — PASS. Commit/PR пока не создавались.

## 6. Decision Records

- **DR-C-001 — CONFIRMED:** Step C engine располагается в `packages/rules`. Причина — согласованный scope и меньшая сложность vertical slice. `packages/simulation` может быть будущей опцией, но перенос сейчас запрещён.
- **DR-C-002 — CONFIRMED:** схема intents, active roster, timer semantics, target/fallback behavior и deterministic RNG описаны в `docs/15-step-c-intent-simulation.md`.
- **DR-C-003 — CONFIRMED:** retreat coefficient, attack order, damage rounding, immunity, event ordering и replay описаны в `docs/16-step-c-retreat-resolution.md`.
- **DR-C-004 — CONFIRMED:** единый HP/damage pipeline, формула `fable.damage.v1`, `hp.changed` v2, enemy removal event, event ordering и replay описаны в `docs/18-step-c-hp-damage-resolution.md`.
- **DR-C-005 — CONFIRMED:** стартовый stamina, `max` из preset, 300-tick regen, cap/inactive timer behavior, affordability, event/replay/hash и excluded scope описаны в `docs/19-step-c-stamina-regeneration.md`.
- **DR-C-006 — CONFIRMED:** минимальная card play команда, один прямой урон, стоимость stamina, discard, replay и excluded scope описаны в `docs/20-step-c-card-play.md`.
- **DR-C-007 — CONFIRMED:** mode-filtered mode-entry shuffle/deal, 300-tick hand rotation, empty draw pile reshuffle, event order и replay описаны в `docs/21-step-c-deck-cycle.md`.
- **DR-C-008 — CONFIRMED:** typed status layer fields/runtime validation, `immobilized`/`bind`, refresh-duration semantics, expiry boundary, events/schema and replay tests описаны в `docs/22-step-c-status-immobilized.md`.
- **DR-C-009 — CONFIRMED:** существующий `ally_guard`, fractional effective defense, refresh/expiry, активный Extinguisher runtime roster, event/replay/hash и no-new-content ограничения описаны в `docs/23-step-c-ally-guard.md`.
- Canonical RNG name: `xoshiro128**`; `algorithmVersion = fable.rng.v1`. `xoshiro128ss` — только внутренний shorthand. Seed encoding — UTF-8; fork seed — SHA-256 компактной canonical JSON array из `rootSeed`, `campaignId`, `sceneId`, `serverTick`, `activeIntentId`, `purpose`. Retreat order не использует RNG; активные purposes включают `target_selection`, `fallback_selection`, `deck_shuffle`.

## 7. Последние проверки

Для Increment 4 (2026-10-27; ветка `step-c-increment-4-hp-damage`, PR #2 слит в `main`):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite.
- `pnpm build` — PASS: `@fable/content` и `@fable/rules`.
- Тесты: **78 passed** — 5 в `content` и 73 в `rules`, 18 test files суммарно.
- Все 5 canonical JSON Schemas проходят Ajv 2020 compilation; `git diff --check` проходит.
- В новой damage/cleanup gameplay logic нет `Math.random()`/`Date.now()`; HP mutations находятся в damage pipeline и replay reducer.
- `pnpm install --frozen-lockfile` был проверен в предыдущем Step C acceptance; повторять при изменении lockfile/dependencies.

При любом новом изменении повторно запустить как минимум `pnpm check` и `pnpm build`, затем сообщить точные результаты. PR #3 (Increment 5), #4 (Increment 6) и #5 (Increment 7) открыты. Следующий increment не начинать без отдельного запроса пользователя и предварительно одобренного плана.

Для Increment 5 (`d237616`; 2026-10-27; ветка `step-c-increment-5-stamina`, PR #3 открыт):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite.
- `pnpm build` — PASS: `@fable/content` и `@fable/rules`.
- Тесты: **91 passed** — 5 в `content` и 86 в `rules`, 21 test file суммарно.
- Все 5 canonical JSON Schemas скомпилированы Ajv 2020; schema test проверяет `stamina.changed` и `maximum >= 3`; `git diff --check` проходит.
- Scene pause, draw/reshuffle, defense slot/full deck lifecycle, production card catalog и иные stamina-spending actions не добавлены.

Для Increment 6 / DR-C-006 (2026-10-27; commit `946b557`, branch `step-c-increment-6-card-play`, PR #4 открыт against PR #3 branch):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite.
- `pnpm build` — PASS: `@fable/content` и `@fable/rules`.
- Тесты: **110 passed** — 5 в `content` и 105 в `rules`, 24 test files суммарно.
- Все 5 canonical JSON Schemas проходят Ajv 2020 compilation; card schema integration tests и `git diff --check` проходят.
- В runtime входят только минимальные `hand`/`discard`/revision и TEST_ONLY / NON_BALANCE fixtures; draw, reshuffle, defense slot, full deck lifecycle, production catalog и UI/network/database/AI не добавлены.

Для Increment 7 / DR-C-007 (2026-10-27; commit `f175a1b`, PR #5 открыт):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite; **122 теста прошли** (5 в `content`, 117 в `rules`), 27 test files суммарно.
- `pnpm build` — PASS: `@fable/content` и `@fable/rules`; `git diff --check` — PASS.
- Schema integration tests прошли, включая Ajv 2020 compilation canonical event schemas и новые card/deck event payloads. Replay tests проверяют event order, deterministic shuffle validation и stateHash parity.
- Использованы только явно помеченные `TEST_ONLY / NON_BALANCE` card fixtures; production catalog, defense slot, UI/network/database/AI не добавлены.

Для Increment 8 / DR-C-008 (2026-10-27; commit `24ca60e`, PR #6 слит в `main`):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite; **137 тестов прошли** (5 в `content`, 132 в `rules`), 31 test file суммарно.
- `pnpm build` — PASS: `@fable/content` и `@fable/rules`; `git diff --check` — PASS.
- 15 status lifecycle/schema tests проверяют typed layer copy/validation, refresh/exact expiry, movement lock before/on expiry, movement resume after refreshed expiry, event/journal replay parity, tampered-log movement rejection и Ajv schema constraints.
- Только `TEST_ONLY / NON_BALANCE` bind/enemy fixtures; production catalog, other statuses, UI/network/database/AI не добавлены.

Для Increment 9 / DR-C-009 (2026-10-27; ветка `step-c-increment-9-ally-guard`, локально без commit/PR):

- `pnpm check` — PASS: typecheck, lint и полный workspace suite; **147 тестов прошли** (5 в `content`, 142 в `rules`), 33 rules test files.
- `pnpm build` — PASS для `@fable/content` и `@fable/rules`; final focused Ally Guard/replay/schema regressions — 12 passed; `git diff --check` и JSON Schema syntax — PASS.
- Golden transcript обновлён и повторно проверен. Ally Guard использует только существующие production templates; новые content/balance values не добавлялись.

## 8. Что ещё не реализовано / ограничения scope

Не считать готовыми или не начинать без отдельного плана и подтверждения: defense slot, production card catalog/balance и расширенный card gameplay, scene pause runtime (pause schemas alone do not imply engine support), statuses other than `immobilized` and `ally_guard`, UI (TV/Player/GM), WebSocket/Colyseus networking, PostgreSQL/persistence, authentication, deployment, AI Copilot, полный combat system и новые карты/сцены. Mode-filtered deal, timed hand rotation и empty-pile reshuffle реализованы Increment 7 в рамках DR-C-007.

В частности, существующий `extinguisher` активен в runtime для `bind`, `ally_guard` и `move_close`; `reposition` остаётся deferred/draft и не является active handler или fallback. Increment 9 не добавлял и не балансировал production content. Не расширять scope молча.

## 9. Инструкция следующему AI

1. Убедиться, что открыт репозиторий `fable-rpg`, ветка и `git status` соответствуют задаче; `fable-context` — context pack, не code target.
2. Прочитать normative документы в порядке выше и соответствующие Decision Records/JSON Schemas.
3. Для новой игровой функции вернуть PLAN с файлами, API/state changes, детерминизмом/replay, тестами, допущениями и вопросами. Не писать код до явного одобрения плана.
4. Не начинать следующий increment по собственной инициативе и не менять уже принятые правила без Decision Record.
5. Сохранять deterministic replay, state hash parity, строгую валидацию contracts и чистое разделение headless rules от UI/network/database.
6. Для code changes использовать feature branch в `fable-rpg`, проверять diff/status, не force-push и открывать PR только по просьбе пользователя.
