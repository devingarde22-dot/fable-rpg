# Step C — read-only audit (2026-10-28)

**Статус:** исторический read-only snapshot без изменений gameplay-кода, content и тестов. Отчёт подготовлен по состоянию `fable-rpg/main` на `b619c77`; он не описывает audited current baseline `7770d04`.

> **Current-status note.** PR #9–#13 были интегрированы PR #14, а PR #15–#18 затем merged. Поэтому выводы ниже нельзя переносить на current main без повторной проверки. Для проверенного статуса ranged/cards/hit/damage см. [verified combat-rules inventory](./30-verified-combat-rules-inventory.md); для текущего handoff — [docs/17](./17-development-log-and-handoff.md). В частности, pause mechanics теперь реализованы, а campaign-global sequence, card taxonomy/magic, hit/miss/critical и float-version policy остаются отдельными вопросами.

## 1. Campaign-global `serverSequence` и несколько сцен — PARTIAL

B-003 требует один строго возрастающий `serverSequence` на campaign, а scene-local порядок получать фильтрацией campaign journal (`docs/04-step-b-baseline.md:37–41`). Фактический `RuntimeState` содержит `nextServerSequence` рядом с одной `scene` (`packages/rules/src/engine/types.ts:266–284`); `createRuntimeState` получает стартовое значение из `initialServerSequence`, по умолчанию `1` (`packages/rules/src/engine/createRuntimeState.ts:131–159`). `eventBase` привязывает событие к `state.scene.id`, а `groupEvents` увеличивает этот счётчик для событий конкретного engine (`packages/rules/src/intents/events.ts:37–49, 58–80`). Поэтому отдельные engine по умолчанию начинают с `1`; общего campaign-level allocator в проверенной реализации не найден.

Текущий `HeadlessCampaign` держит один переданный `SimulationEngine`: посещение города создаёт checkpoint в нём (`packages/rules/src/campaign/HeadlessCampaign.ts:29–45`), `startScene()` меняет campaign location, но не создаёт новый scene/engine (`:63–66`), а исход откатывает тот же engine и создаёт следующий city checkpoint (`:68–87`). Это не подтверждает работу единого счётчика при нескольких разных scene engines или scene transfer. Для них вызывающая сторона должна передать следующий `initialServerSequence`; campaign-level механизм в указанных файлах отсутствует. Вертикальный slice упоминает scene transfer как критерий/возможность, но не реализует его здесь (`docs/05-vertical-slice.md:219–226`).

## 2. `hero.canEnterRangedMode`: флаг или содержимое колоды — CONFIRMED, документация расходится

Реализация требует авторитетный boolean `hero.canEnterRangedMode`: поле есть в runtime type (`packages/rules/src/engine/types.ts:146–156`), проверяется как boolean (`packages/rules/src/engine/invariants.ts:65–66`), а команды входа в ranged mode блокируются, если он `false` (`packages/rules/src/engine/SimulationEngine.ts:105–108, 363–369`). Deck lifecycle отдельно фильтрует карты по `allowedModes`; он не выставляет этот capability (`packages/rules/src/cards/deckLifecycle.ts:16–31, 41–50`). DR-C-003 прямо определяет ranged-доступность через authoritative flag (`docs/16-step-c-retreat-resolution.md:23–24`).

При этом Vertical Slice говорит, что дальний герой может войти в ranged mode, если в его фильтрованной колоде есть разрешённые ranged-карты (`docs/05-vertical-slice.md:116–120`). Это расходится с DR-C-003 и текущим кодом. По факту флаг задаётся конфигурацией героя, не вычисляется из колоды (`packages/rules/src/engine/createRuntimeState.ts:47–78`). Смысловое решение по документационному конфликту не принималось.

## 3. Метрика дальности `ranged_shot`, `bind`, `ally_guard` — CONFIRMED

Все intent range checks используют Chebyshev distance `max(|Δx|, |Δy|)` (`packages/rules/src/intents/geometry.ts:5–7`), и результат сравнивается с inclusive `minInclusive`/`maxInclusive` (`packages/rules/src/intents/targeting.ts:43–59`). Текущие границы: `ranged_shot` 2–7 клеток (`packages/content/src/intentTemplates.ts:57–70`), `bind` 1–5 (`:113–128`), `ally_guard` 1–4 (`:133–147`). Manhattan distance используется только при выборе greedy path step, не при проверке дальности (`packages/rules/src/intents/geometry.ts:36–58`).

## 4. Float-арифметика, Ally Guard и возможная ошибка округления — CONFIRMED

`calculateDamage` использует JavaScript `number`: вычисляет `100 / (100 + defense)`, затем `ceil(rawDamage * mitigation)` и отдельный `ceil(mitigatedDamage * multiplier)` (`packages/rules/src/combat/damage.ts:15–21`). Ally Guard создаёт effective defense умножением `defense * (1 + potency / 100)` (`:24–26`); potency равна 20 (`packages/rules/src/engine/types.ts:35–40`).

Воспроизводимый арифметический пример для raw damage `259`, базовой defense `3` и Ally Guard: float effective defense становится `3.5999999999999996`; произведение на mitigation — `250.00000000000003`, поэтому текущий `ceil` даёт `251`. Точное рациональное значение `259 × 500 / (500 + 6 × 3)` равно `250`, `ceil` даёт `250`. Calculator принимает конечные неотрицательные defense/damage (`damage.ts:15–18`), и runtime invariant допускает любую конечную неотрицательную defense (`packages/rules/src/engine/invariants.ts:41–42`); это демонстрирует уязвимый край, а не заявляет, что такой результат уже наблюдался на типичных encounter stats. Существующий Ally Guard test проверяет умножение без округления, но не exact-rational equivalence (`packages/rules/tests/ally-guard.unit.test.ts:8–48`).

Предложенная форма `ceil(raw × 500 / (500 + 6 × baseDefense))` математически заменяет **только стадию mitigated damage** для ровно 20% bonus; последующий multiplier всё равно применяется отдельной стадией, как сейчас в `damage.ts:20–21`. Изменять формулу или версию без отдельного решения/DR не следует.

## 5. Как карта определяется как `magic` — NOT CONFIRMED

Документация задаёт эффект: magic в melee уменьшает урон на 50%, но не силу статуса (`docs/05-vertical-slice.md:122–125; docs/14-step-c-core-engine.md:461–464, 611–620`). Однако `CardTemplate` содержит `allowedModes`, cost, range, LoS и generic `effect`, но не поле `magic`, тип урона или category (`packages/rules/src/engine/types.ts:40–53`). `resolvePlayCard` проверяет effect kind и `allowedModes`, а для direct damage передаёт `template.effect.multiplier` в общий damage pipeline; отдельной классификации magic или melee-mode multiplier в этом пути нет (`packages/rules/src/cards/playCard.ts:32–35, 69–75`). Mode-neutral fixture показывает только `allowedModes: ["melee", "ranged"]` и `direct_damage` (`packages/rules/tests/fixtures/testCards.ts:39–48`). Следовательно, одного значения `allowedModes = melee|ranged|universal` недостаточно, чтобы определить магию; правило классификации карты в реализации/контракте не найдено. Это требует уточнения, а не догадки.

## 6. Hit chance, critical и miss — PARTIAL

В Core Engine §11 записана формула `criticalFinal = ceil(modeFinal × 1.5)` и сказано, что miss использует отдельный `missMultiplier`, зависящий от stat карты; числового miss coefficient и формулы шанса попадания этот раздел не даёт (`docs/14-step-c-core-engine.md:622–631`). В текущем damage pipeline нет hit/crit/miss roll (`packages/rules/src/combat/damage.ts:15–22`), а успешная direct-damage карта вызывает `applyDamage` без такого roll (`packages/rules/src/cards/playCard.ts:69–75`). RNG purpose registry содержит target/fallback selection, deck shuffle и retreat attack order, но не hit/critical (`packages/rules/src/engine/types.ts:192–200`). Итого: формулировки critical/miss есть в документации; в проверенном Step C runtime они не реализованы, а шанс попадания вообще не определён числом/формулой.

## 7. Scene pause B-006 и rollback confirmationToken B-005 — PARTIAL

B-006 задаёт GM pause/resume и `scene.pause_changed` (`docs/04-step-b-baseline.md:59–67`), но Step C прямо помечает pause engine support как будущую задачу (`docs/14-step-c-core-engine.md:357–364`). В runtime `paused` жёстко задан как `false` (`packages/rules/src/engine/types.ts:281–284`), соответствующей pause API в проверенном `SimulationEngine` нет (`packages/rules/src/engine/SimulationEngine.ts:35–51`). Значит, B-006 не реализован.

B-005 требует GM-only, scoped, single-use, 10-минутный `confirmationToken` до restore (`docs/04-step-b-baseline.md:51–55`). Engine rollback принимает checkpoint ID и не принимает/проверяет token (`packages/rules/src/engine/SimulationEngine.ts:245–257`). Сам in-memory rollback существует: восстанавливает состояние, сохраняет прежний journal, увеличивает revision/sequence, добавляет `rollback.applied` и возвращает новый snapshot; это покрывает test (`packages/rules/tests/rollback.integration.test.ts:5–32`). `EventJournal` проверяет строго возрастающий sequence и добавляет события без удаления истории (`packages/rules/src/journal/EventJournal.ts:9–24`). Итого: rollback-механика реализована, требование авторизации/подтверждения B-005 — нет.

## Rule IDs / связанные решения

`B-002`, `B-003`, `B-005`, `B-006`, `CONTRACT-002`, `TIME-001`, `TIME-003`, `TIME-004`, `TIME-005`; связанные DR: `DR-C-003`, `DR-C-004`, `DR-C-010`.

## Изменения

C не менял gameplay source, content или tests. Этот файл — только отчёт аудита; ни один из отмеченных конфликтов правил не разрешался в коде.
