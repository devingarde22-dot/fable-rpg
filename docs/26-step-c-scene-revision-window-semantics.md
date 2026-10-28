# DR-C-011 — Scene Revision внутри input window

**Статус:** `APPROVED / IMPLEMENTED`
**Область:** обработка player-команд в 250 ms input window. Combat effects и balance formulas не меняются; уточняется confirmed concurrency rule.

## Решение

Для player-команд `clientRevision` остаётся обязательным transport metadata, но глобальная `sceneRevision` не используется как admission- или apply-time gate. `player.move` и mode actions принимаются с любым валидным transport revision и перепроверяют всю action legality по live state при применении. Карты строго защищены `clientCardRevision` именно при применении; устаревший scene cursor или mode самого snapshot не отменяет этот card revision contract. Все текущие проверки наличия карты, режима карты, цели, дальности, линии видимости, ресурсов, живости/доступности героя, movement mode, immobilized, границ/terrain, занятости и резервирования клеток остаются apply-time checks. Rejected inputs не мутируют gameplay state.

Применён Option C согласно разрешению пользователя: player.move не имеет sceneRevision binding. После измерения ниже доля counterfactual legacy stale выше 1%; поэтому C сохранён. Mode actions следуют тому же правилу отсутствия глобального revision gate, как и остальные player commands, а не строгой admission-проверке. Это не распространяет политику на GM branches.

## Затронутые подтверждённые правила

- `TIME-005` в [Confirmed Rules](./02-confirmed-rules.md#time-005--expired-command) уточнён: старый global scene cursor сам по себе не отклоняет player command; legality проверяется при применении, а незаконное действие не превращается в бесплатную мутацию.
- `CONTRACT-002` / [Step B B-002](./04-step-b-baseline.md#b-002--scenerevision-и-clientrevision): `clientRevision` остаётся обязательной transport metadata; только card-specific `clientCardRevision` является строгой проверкой для player card command. Возможные GM/server checks остаются отдельной политикой.

## Детерминированное stress measurement

Тест `packages/rules/tests/revision-window.integration.test.ts` выполняет 610 независимых проб именно `player.move`. Каждая сцена содержит героя и врага с повторяющимся `hold_position` длительностью 3,050 ms (61 tick). Фазы отправки равномерно покрывают 0–60 тиков цикла; задержки доставки циклически покрывают 2, 3, 4 и 5 тиков (100–250 ms при 50 ms/tick), в каждой фазе каждый delay повторяется 2–3 раза. На пробе сохраняется revision отправки, движок продвигается на задержку, фиксируется receive snapshot revision, затем сравнивается с отправкой.

Метрика называется **counterfactual legacy stale rate**: она считает, сколько проб отверг бы старый строгий sceneRevision gate, а не сколько команд отклоняет нынешний C. Отдельно тест подтверждает, что все реальные вызовы `engine.submit(player.move)` поставлены в очередь. Измерено **33/610 = 5.41%** (ровно 33/610; до округления 5.409836%). Это выше порога 1%, поэтому Option C оставлен. Это синтетический детерминированный stress profile для указанной noisy-сцены и фаз/задержек, а не оценка production traffic или реальной доли stale-команд.

## Контракты и источники

`clientRevision` остаётся обязательным в wire schema как transport metadata. Player move/mode/card schema descriptions указывают отсутствие global sceneRevision gate; GM descriptions не получают policy player branches. `clientCardRevision` — строгая card revision, проверяемая при apply. Реализация: `SimulationEngine.submit`, apply pipeline и `resolvePlayCard`. Правила: `CONTRACT-002`, `TIME-003`, `TIME-004`, `TIME-005`.

- [Step B Baseline — B-002](./04-step-b-baseline.md#b-002--scenerevision-и-clientrevision)
- [Step C — Tick loop и command lifecycle](./14-step-c-core-engine.md#6-tick-loop-и-фазы-одного-tick)
- [Vertical Slice — stale revision acceptance](./05-vertical-slice.md#сервер-и-симуляция)
