# Fable — AI Developer Guide

**Версия:** 0.1  
**Статус:** CONFIRMED

## 1. Правило

Не проси AI «сделать Fable». Дай ему одну маленькую задачу, ограниченный context packet, список разрешённых файлов и тесты, которые доказывают результат.

## 2. Context packet template

```md
# Task: <short name>

## Goal
<one testable sentence>

## Read first
- docs/00-product-constitution.md
- docs/01-glossary.md
- docs/02-confirmed-rules.md#<section>
- docs/03-system-contracts.md#<section>
- docs/04-visibility-matrix.md#<section>
- docs/05-vertical-slice.md#<section>

## Rule IDs
- TIME-003
- INTENT-005

## Allowed files
- packages/rules/src/ (relevant headless Core Engine subsystem; see DR-C-001)
- packages/rules/tests/

## Forbidden changes
- lore
- formulas outside Balance Sheet
- public API
- database migrations

## Acceptance
- <given/when/then>

## Deliver
- changed files
- tests
- assumptions
- open questions
- commands run
```

## 3. Agent roles

### Planner

Не редактирует код. Возвращает dependency graph, затронутые Rule IDs, план файлов, риски и вопросы.

### Implementer

Пишет код и tests только в allowed files. Не меняет confirmed rules молча.

### Reviewer

Проверяет diff против contracts, visibility matrix, schemas и acceptance. Ищет утечки и state mutations на клиенте.

### Test Agent

Создаёт unit, simulation, replay, visibility и e2e tests. Не меняет production rules, чтобы тест прошёл.

### Content Agent

Генерирует JSON-контент по schema. Не добавляет hidden fields, новые правила и новые числовые формулы.

## 4. Mandatory AI response format

```md
## Summary

## Changed files

## Rule IDs covered

## Tests added/updated

## Commands run

## Assumptions

## Open questions

## Security/visibility review

## Known limitations
```

## 5. Stop conditions

AI обязан остановиться и вернуть `OPEN_QUESTION`, если:

- два CONFIRMED-документа противоречат друг другу;
- задача требует изменить Schema/API, но это не разрешено packet;
- неясно, должен ли field быть public или GM-only;
- нужен новый gameplay rule;
- неизвестен expected result golden test;
- нужно удалить или мигрировать данные;
- Copilot proposal требует прямого state change.

## 6. Safe prompt

```text
Ты работаешь над Fable как Implementer.

Сначала прочитай только перечисленные файлы. Не ищи молча новые правила по всему проекту.
Реализуй задачу только в allowed files.
Не меняй confirmed gameplay semantics.
Сервер является источником истины; клиент не рассчитывает результат.
Для каждой изменённой ветки добавь тест.
Если документы противоречат друг другу, остановись и верни OPEN_QUESTION.
Не запускай destructive migration и не используй секреты.
В финале верни строго: Summary, Changed files, Rule IDs, Tests, Assumptions, Open questions, Visibility review.
```

## 7. Code review checklist

- [ ] Нет state mutation в UI.
- [ ] Command содержит requestId и clientRevision.
- [ ] Server повторно проверяет ownership и role.
- [ ] Event создаётся только после commit.
- [ ] Повтор команды идемпотентен.
- [ ] Visibility фильтруется до сериализации.
- [ ] Seed записан для случайного исхода.
- [ ] Timer считается сервером.
- [ ] Rollback и reward не дублируют state.
- [ ] Schema и tests обновлены вместе с API.
- [ ] Нет секретов/API key в client bundle.

## 8. Work order

1. Normalize docs and Rule IDs.
2. Create JSON Schema.
3. Implement headless simulation.
4. Add golden tests.
5. Add server room and projections.
6. Add persistence transaction.
7. Add TV/Player/GM clients.
8. Add GM tools.
9. Add read-only AI Copilot.
10. Add state-changing proposal confirmation last.

## 9. Definition of a good AI contribution

Хорошая contribution маленькая, проверяемая и обратимая. По ней можно ответить:

- какое правило она реализует;
- какой event создаёт;
- кто его видит;
- какой тест доказывает результат;
- что произойдёт при retry/reconnect/rollback;
- какие файлы не были затронуты.
