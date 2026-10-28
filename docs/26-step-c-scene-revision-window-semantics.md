# DR-C-011 — Scene Revision внутри input window

**Статус:** `DRAFT — AWAITING USER CONFIRMATION`
**Область:** семантика `clientRevision` при 250 ms input window. Игровые правила не меняются.

## Наблюдаемая проблема

Команда проходит проверку `clientRevision` при постановке в очередь, но повторно проверяется при применении в конце окна. Если между этими моментами независимое событие меняет сцену, ранее принятую команду отклоняет как `STALE_SCENE_REVISION`.

Минимальный сценарий воспроизведения: в tick 60 Player отправляет `player.move` с текущей revision; команда должна примениться на закрытии окна в tick 65. В tick 61 разрешается независимый `hold_position`, и `sceneRevision` растёт. В tick 65 move получает `STALE_SCENE_REVISION`, хотя на входе scheduler её revision была актуальной. Регрессионный тест в `packages/rules/tests/revision-window.integration.test.ts` намеренно фиксирует ожидаемую цель `accepted` и пока падает на текущем поведении.

Проблема касается не только одной команды: любое domain event, возникшее до закрытия окна, может сделать устаревшими все ранее поставленные команды сцены.

## Варианты решения

| Вариант | Семантика | Влияние на `docs/04-step-b-baseline.md` B-002 / CONTRACT-002 | Влияние на replay и `stateHash` | Цена и риск |
|---|---|---|---|---|
| **A. Проверять revision при admission в scheduler (рекомендация)** | Сравнивать revision один раз, когда команда принимается в текущую очередь. При применении повторять semantic/state validation, но не отклонять только из-за более поздней revision. Внутренние batch-конфликты по-прежнему дают `CONFLICTING_BATCH_STATE`. | Сохраняет буквальный смысл B-002: точное равенство на момент принятия в scheduler. Уточнить термин «acceptance» и указать, что это admission, а не позднее применение в конце окна. CONTRACT-002 остаётся strict revision check плюс одна revision на atomic batch. | JSON event schema и canonical state representation не меняются. Replay по уже записанным domain events остаётся прежним; command-journal/retry path должен сохранять admission decision и финальный результат, иначе повтор команды после события не сможет вернуть тот же результат. `stateHash` не меняется для одинаковой принятой последовательности; конечные события могут отличаться от текущего поведения. | Наименьшая правка; соответствует окну scheduler и не превращает accepted input в поздний stale reject. Нужно определить результат очередной команды, если её semantic precondition изменился до применения. |
| **B. Ввести revision на героя/ресурс** | Отслеживать revision затрагиваемого героя (или другого ресурса) отдельно; unrelated enemy/timer events не делают команду stale. Для конфликтов общего поля/клетки нужны собственные правила. | B-002 и CONTRACT-002 придётся расширить: определить actor/entity revision, какие команды её присылают и как сочетаются entity revision и обязательная global `sceneRevision`. Изменятся command/snapshot contracts. | Если revision является authoritative runtime state — она должна входить в event/replay, checkpoint/rollback и canonical `stateHash`; при чисто transport cursor модели нужно отдельно зафиксировать это и тестировать повтор команд. | Точнее отделяет независимые изменения, но существенно расширяет contracts и concurrency model. |
| **C. Ослабить/убрать global revision для выбранных команд** | Для движения, например, проверять клетки/цели при закрытии окна и отказаться от строгой общей revision либо заменить её версией клетки/ресурса. | Противоречит текущему B-002 («для каждой state-changing command»). Нужно изменить B-002, CONTRACT-002 и командные схемы; отдельно определить stale-поведение по каждой команде. | Новая модель должна быть полностью представлена в journal, чтобы повтор/rollback давали те же решения. Если добавятся версии клеток/ресурсов, они потребуют replay/hash поддержки; если это только transport validation — определить, как replay-command reproduces acceptance. | Больше свободы, но больше риск неодинаковых правил между командами и clients.

## Рекомендация

Выбрать **A**: strict `clientRevision` check выполняется один раз на границе admission в scheduler, как написано в B-002; после admission каждое действие всё равно заново проверяет допустимость по актуальному состоянию и может получить соответствующую semantic/batch-ошибку. Это сохраняет scene-wide revision и 250 ms окна, не меняет gameplay effects и минимально затрагивает wire contracts.

Перед подтверждением требуется ответ пользователя: верно ли, что принятая в очередь команда не должна становиться `STALE_SCENE_REVISION` только из-за событий, которые случились уже после её admission?

## Требуемые тесты после выбора

- Regression из tick 60–65: независимый intent меняет `sceneRevision` до закрытия окна; результат ранее admitted команды соответствует выбранному варианту.
- Отправленная изначально stale-команда всё ещё отклоняется без gameplay mutation, domain event и revision increment.
- Семантическое состояние, изменившееся до исполнения, вызывает определённый semantic/batch error, а не частичный эффект.
- Две команды в одном окне, повтор request и завершённый результат idempotency сохраняют установленную семантику.
- Journal/replay parity и hash parity для принятых/отклонённых команд, включая replay ветку после rollback, если command-input log её поддерживает.

## Rule IDs

`CONTRACT-002`, `TIME-003`, `TIME-004`, `TIME-005`.

## Источники

- [Step B Baseline — B-002](./04-step-b-baseline.md#b-002--scenerevision-и-clientrevision)
- [Step C — Tick loop и command lifecycle](./14-step-c-core-engine.md#6-tick-loop-и-фазы-одного-tick)
- [Vertical Slice — stale revision acceptance](./05-vertical-slice.md#сервер-и-симуляция)
