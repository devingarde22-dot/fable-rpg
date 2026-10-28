# DR-C-012 — Extinguisher bind eligibility и uptime

**Статус:** `DRAFT — AWAITING USER CONFIRMATION`
**Область:** выбор целей и длительность контроля существующим `extinguisher`; новые враги, intents и карты не добавляются.

## Наблюдаемое поведение

В текущих подтверждённых значениях `bind` разрешается каждые 12 секунд, накладывая `immobilized` на 15 секунд. Runtime priority Extinguisher выбирает первый допустимый intent в порядке `bind → ally_guard → move_close → hold_position`. В текущем `bind` target filter не исключает уже обездвиженную цель. Поэтому один активный Extinguisher может обновлять тот же статус каждые 12 секунд; пока bind доступен, приоритет не даёт перейти к следующему намерению.

Ожидаемый failing integration test запускает одного героя и одного Extinguisher с фиксированным seed и измеряет 120 секунд после первого bind. Предварительный fairness-критерий для решения: герой должен иметь в этом интервале хотя бы одно непрерывное окно из 5 тиков (250 ms) без `immobilized`. Это предложение, не подтверждённое правило. Тест в `packages/rules/tests/extinguisher-bind-uptime.integration.test.ts` фиксирует его и, как ожидается, падает на текущих настройках 12/15 секунд.

## Варианты

| Вариант | Что изменится | Влияние на контракты, replay и `stateHash` | Компромисс |
|---|---|---|---|
| **A. Не выбирать цель, пока она immobilized** | Добавить `immobilized` в `bind.targetRules.filters.excludedStatuses`. Если все подходящие герои заняты контролем, runtime проверит следующий intent в утверждённом порядке: `ally_guard`, затем `move_close`, затем допустимый fallback. Статус истечёт по текущему 15-секундному правилу, если до того времени нет другого допустимого bind. | JSON Schema уже описывает `excludedStatuses`; wire shape не меняется. Изменится подтверждённое content значение/версия и журнал intent selection; replay должен использовать историческую content version. State hash меняется только через другие выбранные intents/status state, не через новую форму runtime state. | Минимальная правка и ясная защита от непрерывного повторного bind; длительность контроля зависит от числа источников bind и повторной доступности цели. |
| **B. Ввести отдельную временную защиту от повторного bind** | После bind временно исключать цель на заданный cooldown/иммунитет, включая период после истечения статуса; точную длительность и область действия надо выбрать. | Потребуется правило о новом authoritative timer/status и его event lifecycle. Для нового runtime поля нужны contracts/events, reducer, rollback и `stateHash`; вариант через существующий status layer потребует определить, является ли он gameplay-visible и как replay его проверяет. | Лучше контролирует повторный контроль, но добавляет новую механику и больше surface area.
| **C. Изменить только длительность/частоту существующего bind** | Изменить intent interval и/или 15-секундную длительность статуса так, чтобы повтор не обновлял статус до истечения. Точные значения должны быть утверждены; совпадение на boundary важно, потому что intent resolves до status cleanup. | Схема shape может остаться прежней, но изменятся versioned content values, event timers, expected replay transcripts и их hashes. Старые replay должны ссылаться на старую версию content, а не пересчитываться по новой. | Самый прямой числовой способ, но меняет баланс/контент и может оставить длительную неподвижность.

## Требуемое решение пользователя

1. Нужен ли критерий «минимум одно свободное окно 250 ms в течение 120 секунд непрерывного контакта»? Это тестовый safety threshold, а не утверждение, что герой обязан свободно двигаться чаще.
2. Какой вариант выбрать: A, B или C? Для B — какая длительность защиты; для C — какие новые длительности bind/статуса?
3. Разрешаем ли менять подтверждённое content значение `bind.targetRules.filters.excludedStatuses`, если выбран A?

До ответа существующие runtime priority, content templates, status duration, intents и gameplay handlers не изменяются.

## Тесты после выбора

- Fixed-seed integration: один герой под повторным давлением одного Extinguisher; проверить согласованный минимальный free-action interval, число bind/refresh и выбранный fallback.
- Повторить с 2–4 героями, чтобы подтвердить, что цель и союзник выбираются детерминированно и `ally_guard` остаётся следующим допустимым вариантом.
- Exact-tick boundary tests: intent resolution до status cleanup, истечение/refresh на boundary и отсутствие лишнего `status.expired`.
- Детерминированный transcript и journal replay/stateHash parity с выбранной content version; tampered target/timer/fallback по-прежнему отвергаются.
- JSON Schema/content validation; отсутствие изменений production roster, имен новых карт и wire schema, если решение не требует отдельного runtime timer.

## Rule IDs

`TIME-001`, `TIME-003`, `TIME-004`, `TIME-005`; связанные решения: DR-C-002, DR-C-008 и DR-C-009.

## Источники

- [Step C — Extinguisher priority и active registry](./14-step-c-core-engine.md#первый-registry)
- [Quarantine Gates — intent values](./05-vertical-slice.md#23-intent-values)
- [DR-C-008 — bind/immobilized duration и refresh](./22-step-c-status-immobilized.md)
- [DR-C-009 — Ally Guard runtime](./23-step-c-ally-guard.md)
