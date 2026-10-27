# Increment 7 — PLAN и DR-C-007: Mode-filtered Deck & Timed Hand Rotation

**Решение:** DR-C-007 — `CONFIRMED` по правилам, утверждённым пользователем 2026-10-27.  
**Реализация:** выполнена в feature branch `step-c-increment-7-deck-cycle`; `pnpm check`, `pnpm build` и `git diff --check` пройдены.  
**Scope:** тестовая runtime-колода для `packages/rules`; только `TEST_ONLY / NON_BALANCE` card fixtures.

## 1. Цель

Заменить минимальные hand/discard containers Increment 6 на ограниченный боевой цикл колоды: при каждом входе в melee/ranged заново перемешивать карты, допустимые для целевого режима, и раздавать руку; затем управлять изменением руки authoritative timer каждые 15 секунд. Розыгрыш карты не вызывает немедленный добор. Полный production catalog и полный lifecycle колоды не реализуются.

## 2. DR-C-007 — принятые правила

### DR-C-007.1 — Режимная раздача

При каждом переходе в `melee` или `ranged`, включая переход `melee ↔ ranged`, сервер пересобирает mode-eligible pool героя из всех его обычных card instances, фильтрует экземпляры по `CardTemplate.allowedModes`, детерминированно перемешивает пул и выдаёт до 5 карт. Если подходящих карт меньше пяти, рука может быть меньше пяти. Карты, недоступные в текущем режиме, остаются учтёнными и могут быть доступны при следующем переходе режима; ни один instance не теряется или не дублируется.

Для mode-entry shuffle доступны все текущие контейнеры героя: `drawPile`, `hand`, `discardPile`, `excludedForMode`. Это особая пересборка при входе/смене боевого режима, а не обычный reshuffle сброса. За пределами melee/ranged рука не показывается; вход в другой боевой режим вновь строит руку по его фильтру.

### DR-C-007.2 — Нет немедленного добора после play

Успешный `player.play_card` ведёт к уже принятому в Increment 6 discard, но сам по себе не выдаёт новую карту. Добор происходит только при mode-entry deal или по 15-секундному таймеру.

### DR-C-007.3 — Ротация руки

Один интервал равен 300 authoritative ticks при частоте 20 Hz (15 секунд). При каждом timer due сервер выдаёт не более одной карты в левую часть hand:

- Если рука полная (5 карт), сначала карта с крайнего правого места перемещается в discard, затем новая карта приходит слева.
- Если рука меньше пяти из-за сыгранных карт, существующие карты не сбрасываются; одна новая карта, если доступна, приходит слева и заполняет одно освободившееся место.
- Если карты для выдачи нет, hand не меняется; gameplay error и rollback не создаются. Deadline всё равно переносится на следующий 300-tick интервал.

### DR-C-007.4 — Точка отсчёта и непрерывность таймера

Первый интервал начинается при входе из `movement` / `out_of_combat` в melee/ranged:

```text
nextHandRotationAtTick = entryTick + 300
```

Переход `melee ↔ ranged` повторно фильтрует, перемешивает и раздаёт руку, но не перезапускает timer: бой продолжается в том же cadence. При выходе в `movement` активный rotation timer очищается. Следующий вход в боевой режим задаёт новый полный интервал от нового `entryTick`. Ротация выполняется после mode transitions данного tick; timer, созданный при входе, не может сработать немедленно. Время — только authoritative ticks; wall-clock в правилах не используется.

### DR-C-007.5 — Пустая основная колода и reshuffle

Обычный discard reshuffle выполняется только при пустом `drawPile`. Порядок timer rotation:

1. Если hand полная, перенести крайнюю правую карту в discard; если hand неполная, не перемещать имеющиеся карты.
2. Если draw pile не пуста, не трогать discard и взять одну карту из draw pile.
3. Если draw pile пуста и discard не пуст, перемешать весь discard, превратить результат в draw pile и взять верхнюю карту.
4. Если взять карту неоткуда, оставить hand без изменения, перенести timer deadline на следующий интервал и записать replayable rotation outcome без ошибки.

Если при полной руке draw pile пуста, сброшенная в пункте 1 карта входит в discard перед проверкой emptiness. Поэтому она участвует в reshuffle и при единственной доступной карте может немедленно вернуться в руку в рамках той же ротации. Это принятое поведение.

### DR-C-007.6 — Shuffle, события и replay

Использовать существующий deterministic RNG `fable.rng.v1`, purpose `deck_shuffle`; не использовать `Math.random()` или wall-clock. Для mode-entry shuffle начальный набор ID канонизируется сортировкой по `cardInstanceId` перед shuffle. Для discard reshuffle перемешивается весь текущий discard в каноническом порядке ID. RNG fork получает стабильный deck operation key, зависящий от героя, режима/reason и card/deck revision; fork input, `seedRef`, RNG before/after state сохраняются в audit sidecar.

Replay обязан проверить фактический источник карт, mode filter и точное множество ID, повторно выполнить shuffle по recorded canonical RNG input и сверить полный результирующий порядок. Нельзя доверять одним лишь ID из event payload.

#### Порядок событий mode entry

В одной атомарной event group и одной `sceneRevision`:

```text
mode.changed
→ deck.shuffled(reason = mode_entry)
→ card.drawn (по одной карте, в порядке раздачи, до 5 событий)
```

`deck.shuffled` переносит все известные instances в eligible draw pool либо `excludedForMode`; его payload содержит режим, source/eligible/excluded ID sets и полный перемешанный порядок eligible pile. `card.drawn` снимает карту с верхушки draw pile и помещает её слева в hand. Mode transition, shuffle и начальная deal воспроизводятся как одна state transaction.

#### Порядок событий timer rotation

В одной event group/revision:

```text
card.discarded(reason = timer_rotation)  // только когда hand была полной
→ deck.shuffled(reason = discard_exhausted) // только при пустом drawPile и непустом discard
→ card.drawn                         // если удалось получить одну карту
→ deck.rotation_resolved             // всегда фиксирует due tick и следующий deadline
```

Отсутствующие conditional events пропускаются. `deck.rotation_resolved` содержит hero, due tick, новый `nextHandRotationAtTick` и nullable ID перемещённой/добранной карты; он записывается и при no-card no-op, чтобы replay восстановил продвижение таймера. Успешный `player.play_card` остаётся отдельной transaction и не вызывает `card.drawn`.

Все card/deck containers, revision и `nextHandRotationAtTick` включаются в snapshot и canonical `stateHash`. Каждая mode-entry или timer-rotation transaction меняет `sceneRevision` один раз. Replay event group must preserve exact event ordering and same live/replay state hash.

## 3. Scope и явные исключения

Входит: `drawPile`, `hand` (maximum 5), `discardPile`, `excludedForMode`, deck/card revision, mode filter, mode-entry shuffle/deal, right-to-left timer rotation, reshuffle upon empty draw pile, deterministic RNG audit, event contracts и replay.

Не входит: defense slot, production card catalog/balance, draw/reshuffle между сценами или кампаниями, statuses, новые card effects, UI/projections implementation, WebSocket/Colyseus, PostgreSQL/persistence и AI. Тестовые card templates и числа должны иметь явную маркировку `TEST_ONLY / NON_BALANCE`.

## 4. Реализованные изменения по файлам

- `packages/rules/src/engine/types.ts` — полноценный минимальный `HeroCardsRuntime` с `drawPile`, `hand`, `discard`, `excludedForMode`, revision и `nextHandRotationAtTick`; typed deck events, event payloads и command/result types при необходимости.
- `packages/rules/src/engine/createRuntimeState.ts` — принять fixture deck, глубоко копировать containers и задать начальное внебоевое состояние/timer.
- `packages/rules/src/engine/invariants.ts` — уникальность card instance ровно в одном контейнере, template references, maximum hand 5, корректный timer только в combat mode.
- `packages/rules/src/combat/heroModes.ts` — вернуть typed transition/entry effects либо подключить deck lifecycle callback для командных и automatic contact mode transitions.
- `packages/rules/src/cards/deckLifecycle.ts` (новый) — pure deterministic filtering, canonical input ordering, shuffle/deal, timed rotation и safe empty-pile handling.
- `packages/rules/src/rng/DeterministicRng.ts` — переиспользовать unbiased `nextInt`/Fisher–Yates или добавить unit-tested `shuffle`; не менять `fable.rng.v1` fork serialization без необходимости.
- `packages/rules/src/engine/SimulationEngine.ts` и `packages/rules/src/scheduler/orderCommands.ts` — выполнить mode-entry deal при каждом входе в melee/ranged и timer phase после mode transitions; сохранить установленный event ordering с player actions/contact transitions.
- `packages/rules/src/cards/playCard.ts` — адаптировать `hand → discard` к расширенному deck runtime; не вызывать draw из play path.
- `packages/rules/src/replay/replay.ts`, `packages/rules/src/replay/stateHash.ts` — reducers/validation для `deck.shuffled`, `card.drawn`, timer rotation outcome, RNG audit и расширенного deck snapshot.
- `packages/contracts/event.schema.json` — добавить machine schemas для документированного `card.drawn` и нового `deck.shuffled`/`deck.rotation_resolved`; расширить `card.discarded.reason` значением `timer_rotation`; строгая валидация ID arrays, mode, revision, nullable values и due ticks.
- `packages/rules/tests/fixtures/testCards.ts`, `createTestEngine.ts` — fixture decks с melee-only, ranged-only, neutral templates; наглядные малые piles для exhaustion/reshuffle cases.
- Новые `deck-lifecycle.unit.test.ts`, `deck-lifecycle.integration.test.ts`, `deck-lifecycle.replay.integration.test.ts`; расширить `event-schema.integration.test.ts` и golden transcript.
- Decision Record внесён в `docs/21-step-c-deck-cycle.md`, индексирован в `docs/README.md`; `docs/17-development-log-and-handoff.md` обновлён фактическими результатами проверки.

## 5. Тестовый план

### Unit tests

- `allowedModes`: melee-only, ranged-only, mode-neutral; eligible/excluded partition без потерь и дубликатов.
- Mode-entry reconstruction собирает все экземпляры из всех четырёх контейнеров; детерминированно сортирует вход, фильтрует и выдаёт `min(5, eligible count)`.
- Один и тот же seed/fork input даёт идентичную permutation; другие relevant fork inputs меняют её; покрыть empty/single-card pools и unbiased bounds.
- Полная рука: правый ID переходит в discard, один новый ID вставляется слева. Неполная рука: существующие ID остаются, одна новая карта добавляется слева. Hand не превышает 5.
- `drawPile` непустая — discard не shuffle; `drawPile` пустая — полный discard shuffle; новая правая карта входит в reshuffle по принятому порядку; единственная карта может вернуться; невозможный draw безопасно no-op.
- Успешный и отклонённый card play не порождают немедленный `card.drawn`.

### Integration tests

- Каждый переход в melee/ranged выдаёт только допустимый набор, включая `melee ↔ ranged`; automatic contact transition также обрабатывает mode-entry.
- Timer стартует в точности `entryTick + 300`; melee↔ranged не сбрасывает due tick; выход в movement очищает timer; повторный вход запускает новый полный интервал.
- Due tick даёт ровно одну rotation transaction, в том числе на границе mode transition; событие не повторяется на соседнем tick.
- Timer срабатывает только в боевом режиме; в movement hand rotation отсутствует.
- Розыгрыш карты уменьшает руку/обновляет discard, но не вызывает draw; последующий timer due действует по правилам full/short hand.
- Тесты на empty draw/discard, exhaustion, shuffle including just-discarded card, no-card no-op и продвижение next deadline.

### Replay/schema/regression tests

- Mode-entry group и rotation group дают точный snapshot/stateHash live и после event/journal replay.
- Replay отвергает незарегистрированные/дублированные/потерянные ID, неверный `allowedModes`, неверный shuffle input/order, неправильный `seedRef`/audit, rotation вне due tick, неверный next deadline и неправильную последовательность events.
- Ajv принимает valid `card.drawn`, `deck.shuffled`, `deck.rotation_resolved`, timer `card.discarded`; отвергает невалидные mode/reason/order/payload values.
- Существующие Increment 5/6 regressions: stamina regen/cost/timer, card damage, card discard, scene revisions, command revision checks, mode/contact transitions и golden transcript.
- Финальные quality gates: `pnpm check`, `pnpm build`, compilation всех canonical JSON Schemas через Ajv 2020, `git diff --check`.

## 6. Definition of Done

- Каждый переход в melee/ranged создаёт mode-eligible shuffle/deal до 5 карт; hand/discard/excluded transitions не теряют и не дублируют instances.
- Timer имеет точную точку отсчёта: entry + 300 ticks; продолжается при melee↔ranged; прекращается при выходе в movement; повторный вход запускает новый полный интервал.
- Каждые 300 combat ticks при доступном пуле ротация добавляет одну карту слева; при полной руке сначала сбрасывает правую карту; розыгрыш не вызывает немедленный draw.
- Discard reshuffle происходит только при пустой draw pile; карта, только что перемещённая из полной руки в discard, участвует в этом reshuffle; empty case безопасен и timer deadline всё равно воспроизводится.
- Shuffle использует deterministic RNG/audit; события соответствуют schema; replay подтверждает точную permutation, весь event order и live `stateHash` parity.
- Все тесты Increment 5/6 и Increment 7, workspace checks, build, schema compilation и diff checks проходят; используются только `TEST_ONLY / NON_BALANCE` fixtures; excluded systems не добавлены.

## 7. Статус утверждения и следующий шаг

Пользователь утвердил правила timer, mode-entry shuffle/deal, отсутствие immediate draw при play, empty-pile handling и replay event ordering 2026-10-27. DR-C-007 фиксирует эти правила как `CONFIRMED`; реализация Increment 7 выполнена в ветке `step-c-increment-7-deck-cycle`. После прохождения quality gates следующий шаг — представить отчёт пользователю; отдельные commit/push/PR в это задание не входят.
