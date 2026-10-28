# Step C audit and follow-up work log — 2026-10-28

**Статус:** исторический work log. На момент его подготовки follow-up branches были отдельными; PR #9–#13 затем интегрированы PR #14, а audited current `main` достиг `7770d04` после PR #15–#18. Для текущего состояния см. [verified combat-rules inventory](./30-verified-combat-rules-inventory.md) и [handoff](./17-development-log-and-handoff.md).

## Краткий итог

Выполнен read-only аудит семи областей Core Engine, подготовлены два решения по обнаруженным вопросам и добавлены тесты/реализация для уже выбранных пользователем вариантов. Отдельно синхронизирована проектная документация. A1/A2 и документационные изменения отправляются раздельными PR, чтобы каждую часть можно было проверить независимо.

## A1 — revision admission, input windows и измерение задержки

Исходный дефект: `clientRevision` проверялся при постановке команды в очередь, а затем повторно на закрытии input window. Событие, возникшее между этими моментами, могло отклонить уже поставленную команду `STALE_SCENE_REVISION`, даже если её фактическое действие оставалось допустимым.

Пользователь утвердил правило: удалять позднее сравнение общей revision; на исполнении заново проверять реальную законность действия по актуальному состоянию — активен ли герой, его режим, `immobilized`, актуальная цель/клетка, свободна ли клетка, stamina и остальные предусловия. Приёмочные и семантические проверки остаются на своих границах; невалидная команда не должна частично менять gameplay state или журнал.

Для связи задержки и частоты stale был добавлен детерминированный stress test для `player.move`: 610 проб покрывают 61 фазу цикла с повторяющимся `hold_position` длительностью 3,050 ms и задержки 2–5 тиков (100–250 ms при 50 ms/tick). Измеренная доля команд, которые отклонил бы прежний строгий scene-revision gate, составила **33/610 = 5.41%**. Это синтетический stress profile, не оценка production-трафика. Так как он выше согласованного порога 1%, пользователь заранее разрешил переход к варианту C.

В применённом варианте C player-команды не используют глобальный `sceneRevision` как admission/apply gate. Карта остаётся защищена строго проверяемым `clientCardRevision` при исполнении; проверки режима карты, наличия карты, цели, дальности, LoS и стоимости остаются. Движение и смена режима при применении заново проверяются по live state. Тест подтверждает, что все 610 реальных `submit(player.move)` ставятся в очередь; 33/610 — counterfactual отказ при прежней политике. `clientRevision` оставлен обязательной transport metadata, но не является gate для player-команд.

Работа: [PR #10 — DR-C-011](https://github.com/devingarde22-dot/fable-rpg/pull/10), ветка `step-c-dr-c-011-scene-revision`. Подробное решение и метрика находятся в `docs/26-step-c-scene-revision-window-semantics.md` этого PR.

## A2 — повторный Extinguisher bind и свободное действие

Пользователь выбрал вариант A: уже `immobilized` герой исключается из eligible targets существующего `bind`. Интервал intent `12 s`, длительность статуса `15 s`, порядок intent/fallback и production roster не меняются. Поскольку меняется подтверждённое content-поведение, `bind` получил version 2; предыдущая версия остаётся исторически различимой для replay.

Первоначально предложенные 10 секунд свободного действия в каждом 30-секундном скользящем окне не выполняются. Пользователь разрешил менять числовой порог; exhaustive fixed-seed test перебрал все 1,801 окна, сдвигаемые с шагом 50 ms, и измерил minimum longest-free-run 150 тиков (7,5 секунды). Поэтому принятое acceptance criterion — не менее **7,5 секунд непрерывного free action в каждом sliding 30-second window** за 120-секундное наблюдение; это 30 input windows по 250 ms, без изменения игрового тайминга. Свободное окно между последующими bind application — около 27 секунд.

Boundary test фиксирует фазовый порядок. На expiry tick 540 enemy phase ещё видит героя immobilized, поэтому повторный `bind` не выбирает его и срабатывает допустимый `hold_position`; затем статус истекает в status phase. На следующем подходящем выборе (tick 840 после завершения `hold_position`) герой снова может быть выбран целью. Replay с тем же seed даёт те же status ticks и state hash.

Работа: [PR #11 — DR-C-012](https://github.com/devingarde22-dot/fable-rpg/pull/11), ветка `step-c-dr-c-012-extinguisher-bind`. Решение и точная граница фаз описаны в `docs/27-step-c-extinguisher-bind-uptime.md` этого PR.

## B — синхронизация проектной документации

В ветке `step-c-doc-sync-review` и [PR #12](https://github.com/devingarde22-dot/fable-rpg/pull/12):

- README и handoff показывают фактический статус Increment 10 (PR #8 слит) и открытого idempotency follow-up PR #9; актуальный прогон на `main` — 164 теста (5 content + 159 rules).
- Составной idempotency key зафиксирован как `(sessionId, actorId, requestId)`; request ID в нескольких event rows не трактуется как уникальный.
- Реестр событий включает уже контрактованные `deck.shuffled` и `deck.rotation_resolved`; `DeckRuntime` учитывает ровно один `defenseSlot`.
- `fable-context` отмечен в root README как старый context pack, который может отставать; `fable-rpg` остаётся источником текущей реализации.
- Существующее противоречие о том, закрывает ли retreat узел, сохранено как открытый вопрос; решение не выдумано и правила не переписаны.
- Ранее предложено считать PR #3–#5 избыточными, так как соответствующая история вошла в `main` через PR #6; сами PR не закрывались.

Этот work log связан с B PR, чтобы текущая handoff-документация показывала и историю принятых follow-ups, но A1, A2, B и C остаются отдельными PR.

## C — результаты read-only аудита Core Engine

[PR #13](https://github.com/devingarde22-dot/fable-rpg/pull/13), ветка `step-c-c-audit-report`, содержит отчёт `docs/28-step-c-read-only-audit-2026-10-28.md` с file:line доказательствами. Краткий перечень:

1. Campaign-global `serverSequence` между несколькими независимыми scene engines не обеспечивается общим allocator; внутри одного `HeadlessCampaign` используется один engine.
2. Код берёт ranged capability из authoritative hero flag, тогда как Vertical Slice описывает связь с filtered deck; конфликт документов остался открытым.
3. Диапазоны `ranged_shot`, `bind` и `ally_guard` используют Chebyshev distance с inclusive границами.
4. Float-арифметика Ally Guard имеет крайний пример, где ceil даёт 251 вместо рационального 250; формула не менялась, поскольку её изменение требует отдельного решения.
5. В модели карты не найден явный `magic` marker/category; `allowedModes` сам по себе не определяет magic.
6. Critical/miss описаны в документации частично, но hit/crit/miss rolls не найдены в проверенном runtime; численный hit chance не задан.
7. Scene pause и rollback confirmation token не реализованы, хотя in-memory rollback без потери истории и с монотонными revision/sequence работает.

Ветка C не меняет gameplay source, content или tests.

## Проверки по веткам

- **A1:** `pnpm check` PASS: 5 content tests и 163 rules tests; typecheck/lint PASS. `pnpm build`, JSON parse всех пяти contract schemas и `git diff --check` PASS.
- **A2:** `pnpm check` PASS: 5 content tests и 161 rules tests; typecheck/lint PASS. `pnpm build`, JSON parse всех пяти contract schemas и `git diff --check` PASS.
- **B/C baseline:** `pnpm check` PASS: 5 content tests и 159 rules tests (164 всего); `pnpm build` PASS. Для B также проверены JSON contracts, локальные Markdown file links и diff whitespace.

Числа относятся к фактическим тестам в каждой ветке; A1/A2 содержат новые тесты относительно текущего `main`.

## GitHub / merge status

- [PR #10](https://github.com/devingarde22-dot/fable-rpg/pull/10) — DR-C-011, A1 — **merged through PR #14**.
- [PR #11](https://github.com/devingarde22-dot/fable-rpg/pull/11) — DR-C-012, A2 — **merged through PR #14**.
- [PR #12](https://github.com/devingarde22-dot/fable-rpg/pull/12) — B documentation sync and this work log — **merged through PR #14**.
- [PR #13](https://github.com/devingarde22-dot/fable-rpg/pull/13) — C audit report — **merged through PR #14**.

This work log preserves the pre-merge evidence. It is not a statement that those branches remain open or that `main` remains at `b619c77`.

## Вопросы, не решённые этой работой

- Что именно является campaign-wide allocator при переходе между разными scene engines?
- Должен ли ranged capability зависеть от hero flag или filtered deck?
- Какой явный контракт отличает magic-карту от немагической?
- Нужны ли отдельные Decision Records для float-устойчивой damage formula и численных hit/critical/miss правил?
- Нужны ли в будущем pause и GM confirmation token для rollback?
- Retreat: закрывает ли он узел или оставляет доступным для повторного прохождения? Два документа по-прежнему расходятся.
- Закрывать ли старые PR #3–#5 как избыточные? Пока они оставлены открытыми.
