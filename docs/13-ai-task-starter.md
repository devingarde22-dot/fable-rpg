# Fable — AI Task Starter

**Версия:** 0.1  
**Назначение:** готовый способ передать Fable AI-разработчику и начать первую задачу.

> **Область применения:** это переиспользуемый starter Шага A для нового repository, а не prompt текущей задачи. Проект уже перешёл к Step C; headless Core Engine находится в `packages/rules` согласно DR-C-001. Не начинай Step A заново и не создавай/переноси engine в `packages/simulation`.

## 1. Что загружать

Для первой задачи не нужно загружать весь HTML-сайт и всю историю чата. Загрузите эти файлы:

```text
docs/README.md
docs/00-product-constitution.md
docs/01-glossary.md
docs/02-confirmed-rules.md
docs/03-system-contracts.md
docs/04-visibility-matrix.md
docs/04-step-b-baseline.md
docs/05-vertical-slice.md
docs/06-balance-sheet.md
docs/07-qa-and-acceptance.md
docs/08-api-specification.md
docs/09-database-schema.md
docs/10-ai-developer-guide.md
docs/11-programming-roadmap.md
docs/12-step-a-repository-and-monorepo.md
packages/contracts/command.schema.json
packages/contracts/event.schema.json
packages/contracts/intent.schema.json
packages/contracts/visibility.schema.json
```

`index.html` можно приложить дополнительно как визуальный обзор, но AI-разработчику он не нужен для первой кодовой задачи.

## 2. Что написать AI-разработчику

Скопируйте этот prompt после загрузки файлов:

```text
Ты работаешь как senior TypeScript engineer над проектом Fable.

Сначала прочитай только загруженные документы. Приоритет источников:
1. подтверждённое server state и Step B Baseline;
2. 00-product-constitution.md;
3. 02-confirmed-rules.md;
4. 03-system-contracts.md и typed JSON Schema;
5. 05-vertical-slice.md;
6. остальные документы как уточнение.

Не придумывай новые gameplay rules. Если найдёшь противоречие, остановись и верни OPEN_QUESTION с указанием файлов и Rule ID.
Сервер является источником истины. Клиент не рассчитывает HP, урон, доступность карты, цели, таймеры или результат команды.
Не используй секреты и не добавляй API keys в client code.

Твоя первая задача: реализовать Step A — repository и monorepo scaffold.

Создай только:
- package.json;
- pnpm-workspace.yaml;
- tsconfig.base.json;
- vitest.workspace.ts;
- eslint.config.js;
- prettier.config.cjs;
- .editorconfig;
- .gitignore;
- .env.example;
- package manifests и пустые src/index.ts для workspace packages;
- минимальные smoke tests;
- README с командами запуска.

Используй границы из 12-step-a-repository-and-monorepo.md:
- @fable/contracts;
- @fable/rules (pure rules and, for Step C, the headless Core Engine per DR-C-001);
- @fable/content;
- @fable/test-fixtures;
- server;
- apps/tv;
- apps/player;
- apps/gm.

Не делай на этой задаче:
- gameplay implementation;
- React screens;
- WebSocket room;
- PostgreSQL migrations;
- AI Copilot;
- Docker deployment;
- новые игровые правила.

Перед изменением файлов сначала верни короткий PLAN:
1. какие файлы создашь;
2. какие зависимости добавишь;
3. как проверишь отсутствие циклических imports;
4. какие команды запускаешь.

После моего подтверждения реализуй план.

Финальный ответ верни в формате:

## Summary
## Changed files
## Rule IDs covered
## Tests and commands run
## Assumptions
## Open questions
## Security/visibility review
## Known limitations

Критерий готовности:
- pnpm install --frozen-lockfile;
- pnpm check;
- TypeScript strict проходит;
- lint проходит;
- smoke tests проходят;
- simulation не зависит от UI, DB, WebSocket или AI;
- секретов в repository нет.
```

## 3. Как работать после первого ответа AI

Если AI вернул `PLAN`, проверьте только границы и зависимости. Не нужно проверять каждую строку кода до начала работы.

После реализации попросите AI выполнить:

```text
Покажи git diff и выполни pnpm check.
Проверь dependency graph: contracts → rules (including the Step C Core Engine) → server/apps.
Подтверди, что gameplay, UI, DB и AI не были добавлены в Step A.
Если всё проходит, подготовь список файлов для commit, но не выполняй commit без моего разрешения.
```

## 4. Следующая задача после Step A

После принятия scaffold загрузите тот же пакет плюс этот файл и дайте следующую задачу:

```text
Теперь реализуй Step B, но начни только с @fable/contracts.

1. Подключи command.schema.json, event.schema.json, intent.schema.json и visibility.schema.json.
2. Добавь runtime validation.
3. Добавь valid/invalid fixtures.
4. Добавь тесты на discriminated unions, additionalProperties:false и version fields.
5. Не реализуй server router и gameplay simulation.
6. Сначала верни PLAN, затем жди моего подтверждения.
```

## 5. Что не нужно делать

Не отправляйте AI-разработчику только скриншоты сайта. Скриншот не является контрактом. Не отправляйте только `index.html`: в нём есть контекст, но нет удобных typed API-границ. Не просите «сделай всю игру». Одна AI-задача должна затрагивать ограниченный слой и иметь тестируемый Definition of Done.
