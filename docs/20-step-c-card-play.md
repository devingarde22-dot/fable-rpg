# DR-C-006 — Minimal Card Play (Increment 6)

**Статус:** CONFIRMED; implementation находится в локальной ветке `step-c-increment-6-card-play`, не закоммичен и не опубликован.
**Область:** один `player.play_card` для карты, уже находящейся в руке героя.
**Предпосылки:** DR-C-004 (HP/damage) и DR-C-005 (stamina/regeneration).

## Принятые решения

1. Runtime хранит только минимальные `hand`, `discard` и `revision` героя плюс зарегистрированные card templates. Полная колода не моделируется.
2. Используются только тестовые fixtures с явной маркировкой `TEST_ONLY / NON_BALANCE`; production card catalog и баланс карт не определяются.
3. Разрешён только одиночный прямой урон по одной активной вражеской цели. Перед применением проверяются active/alive hero, текущий режим и режим карты, наличие карты в hand и актуальный `clientCardRevision`, цель и её HP, range, LoS и stamina.
4. Урон рассчитывается общим pipeline `fable.damage.v1` из DR-C-004. Успешная карта перемещается из hand в discard и увеличивает card revision.
5. Положительная стоимость списывает stamina и перезапускает timer на `serverTick + 300`; при недостатке stamina команда отклоняется до игровой мутации. Стоимость `0` допустима при `0` stamina и сама по себе не создаёт `stamina.changed`.
6. Одна успешная карта образует одну event group/revision с порядком `card.played` → `stamina.changed` (только при положительной стоимости) → `hp.changed` v2 с card source → `card.discarded`. Независимое событие regeneration может идти позднее в той же tick batch, если timer именно тогда наступил.
7. Replay проверяет целостность transaction: actor, карту и template, mode, стоимость, target/range/LoS, stamina delta и новый timer, `hp.changed` source/effect, discard и его revision. Card containers/revision и stamina timer входят в canonical `stateHash`.
8. `command.schema.json` уже содержит `player.play_card`; поэтому его не меняли. `event.schema.json` расширена отсутствовавшим `card.discarded` и card source в `hp.changed` v2; `card.played` теперь требует `targetEntityId` и `targetCell`, которые replay использует для проверки.

## Границы scope

Не реализуются draw, reshuffle, defense slot, полная deck lifecycle, production card catalog/balance, statuses, UI, WebSocket/Colyseus, PostgreSQL/persistence или AI. Никакая карта не добавляется в production content catalog.

## Проверки и Definition of Done

- Unit: бесплатная/положительная стоимость, нехватка stamina, mode/target/range/LoS/HP/actor checks и отсутствие мутации при отказе.
- Integration: успешный прямой урон, `hand → discard`, card revision, stamina/timer semantics, стоимость `0`, отказ без card mutation, timer reset при совпадении с прежним due tick.
- Replay: точный snapshot и hash parity; reject некорректной стоимости, пропуска обязательных событий, изменённого damage source и discard revision.
- Contracts: валидация всех созданных card events JSON Schema.
- DoD: полный `@fable/rules` suite, workspace `pnpm check`, `pnpm build`, все canonical JSON Schemas проходят Ajv 2020, `git diff --check` чист.
