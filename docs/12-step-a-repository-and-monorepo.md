# Fable — Step A: Repository & Monorepo

**Версия:** 0.1  
**Статус:** CONFIRMED PLAN / CORE WORKSPACE SCAFFOLD IMPLEMENTED
**Связанные документы:** `00-product-constitution`, `03-system-contracts`, `05-vertical-slice`, `10-ai-developer-guide`, `11-programming-roadmap`

## Decision Record DR-C-001 — Step C engine package boundary

- **Decision:** Step C engine lives in `packages/rules`.
- **Status:** CONFIRMED.
- **Reason:** the agreed Step C scope places the first headless engine there and this keeps the first vertical slice less complex.
- **Consequence:** for Step C, `packages/rules` contains pure rule functions, `SimulationEngine`, tick loop, scheduler, journal and replay. The engine remains headless and has no UI, WebSocket, database or room dependency.
- **Future option:** `packages/simulation` may be introduced later if the split is needed after the vertical slice. It is not a current package boundary and must not be created by moving the Step C implementation without a new decision.

## 1. Цель Шага А

Шаг А не создаёт gameplay. Он создаёт предсказуемое рабочее пространство, в котором AI-разработчик сможет добавлять simulation, server и интерфейсы маленькими проверяемыми изменениями.

После завершения шага:

- новый разработчик клонирует repository;
- устанавливает зависимости одной командой;
- запускает typecheck, lint и tests;
- понимает, где лежат контракты, simulation, server, content и clients;
- не может случайно импортировать базу данных или UI-логику в headless Core Engine из `packages/rules`;
- получает одинаковую структуру контекста в любой AI-сессии.

## 2. Решение по инструментам

### 2.1 Package manager

Используем **pnpm workspaces**. На первом шаге не добавляем Turborepo, Nx или другой task orchestrator: проекту пока важнее прозрачность, чем распределённый build cache.

### 2.2 Runtime

Используем Node.js LTS, зафиксированный через `.nvmrc` или Volta. Конкретная мажорная версия должна быть записана в repository toolchain record; все разработчики и CI используют одну версию.

### 2.3 Язык

Весь production-код — TypeScript в strict mode. JavaScript допускается только для конфигурационных файлов, если это требуется инструментом.

### 2.4 Tests

- Vitest — unit, contract и simulation tests.
- Playwright подключается позже для E2E.
- JSON Schema проверяется Ajv или эквивалентным validator.
- Каждый новый public contract получает valid/invalid fixture.

### 2.5 Форматирование и качество

- ESLint — ошибки и опасные паттерны.
- Prettier — единый формат.
- TypeScript `noEmit` — обязательная проверка типов.
- CI запускает те же команды, что и локальная машина.

## 3. Структура repository

```text
fable/
├─ apps/
│  ├─ tv/                         # public TV projection; позже React/Vite
│  ├─ player/                     # player phone web client
│  └─ gm/                         # GM tablet web client
│
├─ server/
│  ├─ room/                       # WebSocket/Colyseus room adapter
│  ├─ api/                        # HTTP routes и auth boundary
│  ├─ projections/                # server-side filtered projections
│  └─ persistence/                # Drizzle repositories, migrations adapter
│
├─ packages/
│  ├─ contracts/                  # TypeScript types + JSON Schema
│  ├─ rules/                      # pure rules + Step C headless Core Engine (DR-C-001)
│  ├─ content/                    # validated cards/enemies/nodes fixtures
│  ├─ test-fixtures/              # seeds, scenes, golden snapshots
│  └─ config/                     # shared safe config, no secrets
│
├─ tests/
│  ├─ contract/                   # Schema and envelope tests
│  ├─ simulation/                 # cross-package deterministic tests
│  ├─ visibility/                 # TV/Player/GM/AI leakage tests
│  ├─ replay/                     # event journal replay tests
│  └─ e2e/                        # Playwright, подключится позже
│
├─ docs/                          # source-of-truth Markdown
├─ packages/contracts/*.json      # machine-readable contracts
├─ scripts/                       # safe developer commands
├─ infra/                         # Docker/dev services позже
│
├─ package.json                   # root scripts and dev dependencies
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ tsconfig.base.json
├─ vitest.workspace.ts
├─ eslint.config.js
├─ prettier.config.cjs
├─ .editorconfig
├─ .gitignore
├─ .env.example
├─ .nvmrc
└─ README.md
```

## 4. Назначение пакетов

### `packages/contracts`

Содержит только публичные формы данных:

- command/event envelopes;
- DTO;
- enum и literal unions;
- JSON Schema;
- error codes;
- visibility annotations.

**Запрещено:** считать урон, читать БД, импортировать React, обращаться к WebSocket.

### `packages/rules`

Содержит чистые rule functions без IO, а на этапе Step C также владеет headless Core Engine по DR-C-001:

- `calculateDamage()`;
- `calculateHeal()`;
- `canPlayCard()`;
- `canEnterMode()`;
- `isCellBlocked()`;
- `selectIntentTarget()`;
- `applyStatusLayer()`;
- `SimulationEngine`, tick loop, scheduler, journal и replay.

Одинаковый input всегда даёт одинаковый output. Rule functions остаются pure; только `SimulationEngine` изменяет собственный authoritative runtime state. Пакет не зависит от UI, WebSocket, room adapters или базы данных.

### Будущая опция: `packages/simulation`

Этот пакет сейчас не создаётся и не является текущей границей реализации. После vertical slice его можно ввести отдельным Decision Record, если разделение Core Engine и pure rule functions снизит сложность, не дублируя и не перемещая текущую логику преждевременно.

### `packages/content`

Validated content fixtures:

- hero presets;
- card templates;
- enemy templates;
- intent templates;
- node/scene templates;
- vertical slice map.

Контент не содержит произвольного executable JavaScript. Он загружается через Schema.

### `packages/test-fixtures`

Фиксированные seeds, initial state, expected events и golden snapshots. Этот пакет нужен для повторяемых тестов и не должен использовать production secrets.

### `server/`

Транспортные и инфраструктурные адаптеры вокруг headless Core Engine из `packages/rules`:

- auth;
- command transport;
- room lifecycle;
- persistence;
- projection filtering;
- reconnect.

Server не дублирует формулы или state machine из `packages/rules` и не реализует вторую боевую модель.

### `apps/*`

Тонкие клиенты. Они:

- отображают projection;
- отправляют commands;
- показывают loading/error/stale states;
- не решают, разрешена ли карта или клетка.

## 5. Граф зависимостей

Разрешённое направление:

```text
       contracts
       ↙      ↘
    rules     content
      ↘        ↙
       server ─────→ persistence
         ↓
 apps/tv, apps/player, apps/gm
```

Более формально:

| Пакет | Может импортировать | Не может импортировать |
|---|---|---|
| contracts | только стандартную библиотеку | server, DB, UI |
| rules (including Step C Core Engine) | contracts | UI, server, DB, WebSocket, browser APIs |
| content | contracts | server, UI |
| server | contracts, rules, content | directly owned UI state; a second copy of engine logic |
| apps | contracts, client SDK | Core Engine internals, DB, GM-only server state |
| tests | любой production package | secrets и production database |

Циклические зависимости запрещены.

## 6. Root files

### `package.json`

Root package должен содержать только workspace scripts и общие dev dependencies.

```json
{
  "name": "fable",
  "private": true,
  "packageManager": "pnpm@<pinned-version>",
  "scripts": {
    "dev": "pnpm --parallel --filter './apps/*' dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "test:rules": "pnpm --filter @fable/rules test",
    "test:contracts": "pnpm --filter @fable/contracts test",
    "validate:content": "pnpm --filter @fable/content validate",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  }
}
```

`packageManager` и Node version должны быть зафиксированы конкретными значениями при фактическом создании repository.

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "server/*"
  - "packages/*"
```

### `tsconfig.base.json`

Обязательные параметры:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true,
    "noEmit": true
  }
}
```

Конкретные настройки bundler/client могут расширять base config, но не ослаблять strict rules без ADR.

### `.env.example`

```text
NODE_ENV=development
PORT=2567
DATABASE_URL=postgres://postgres:postgres@localhost:5432/fable
SESSION_SECRET=replace-me-in-local-env
AI_API_BASE_URL=
AI_MODEL=
```

`.env` не коммитится. API keys никогда не попадают в apps.

## 7. Минимальные package boundaries

Каждый workspace package имеет:

```text
package.json
src/
  index.ts
  ...
tests/ или __tests__/
tsconfig.json
README.md (если package имеет нетривиальный контракт)
```

Public exports идут только через `src/index.ts`. Глубокие imports вроде `@fable/rules/src/engine/internal/...` запрещены.

Примеры имён:

```text
@fable/contracts
@fable/rules
@fable/content
@fable/test-fixtures
@fable/server
@fable/tv
@fable/player
@fable/gm
```

`@fable/simulation` не входит в текущий workspace package list; см. future option в DR-C-001.

## 8. Порядок выполнения внутри Шага А

### A1 — создать repository

- создать Git repository;
- добавить README и license/ownership policy;
- создать `.gitignore`, `.editorconfig`, `.nvmrc`, `.env.example`;
- добавить pnpm workspace.

### A2 — настроить quality gates

- TypeScript strict;
- ESLint;
- Prettier;
- Vitest;
- root `check` command;
- CI workflow, запускающий `pnpm check`.

### A3 — создать пустые packages

Создать `contracts`, `rules`, `content`, `test-fixtures` с минимальным `index.ts` и smoke test. Step C Core Engine позднее размещается в `rules` согласно DR-C-001.

### A4 — подключить docs

- добавить `docs/` в repository;
- перенести Markdown context pack;
- добавить ссылку на commit/version в README;
- создать `ai/AGENTS.md` с правилами работы агентов.

### A5 — первый технический check

На чистом checkout:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Команды должны завершиться успешно без PostgreSQL, AI key и browser setup.

## 9. Что не делать на Шаге А

Не подключать на этом шаге:

- production PostgreSQL;
- Colyseus room logic;
- React screens;
- сложную авторизацию;
- AI Copilot;
- Drizzle migrations;
- Docker deployment;
- полный content editor;
- реализацию боевых правил.

Иначе repository setup смешается с gameplay и станет сложно понять, где ошибка.

## 10. Как использовать AI на Шаге А

AI получает такой context packet:

```text
Read:
- docs/00-product-constitution.md
- docs/01-glossary.md
- docs/10-ai-developer-guide.md
- docs/11-programming-roadmap.md
- docs/12-step-a-repository-and-monorepo.md

Allowed files:
- package.json
- pnpm-workspace.yaml
- tsconfig.base.json
- vitest.workspace.ts
- eslint.config.js
- prettier.config.cjs
- .editorconfig
- .gitignore
- .env.example
- package manifests only

Forbidden:
- gameplay rules
- database schema
- UI implementation
- AI integration
- secrets

Acceptance:
- pnpm install --frozen-lockfile
- pnpm check
- no circular dependencies
- no app imports Core Engine internals from `packages/rules`
```

AI сначала должен вернуть план файлов. После подтверждения можно разрешить ему создать scaffold.

## 11. Definition of Done

Шаг А завершён, если:

- repository создан и имеет фиксированный package manager/runtime;
- `pnpm install --frozen-lockfile` работает на чистом checkout;
- workspace packages видны pnpm;
- TypeScript strict проходит;
- ESLint и Prettier проходят;
- Vitest smoke tests проходят;
- CI выполняет те же quality gates;
- есть README с командами запуска;
- есть `.env.example`, но нет секретов;
- dependency graph не содержит циклов;
- contracts, `packages/rules` Core Engine, content и server имеют ясные boundaries;
- пять базовых Markdown-документов и технические документы доступны из repository;
- AI context packet для Шага А воспроизводим;
- gameplay-код ещё не начал проникать в setup commit.

## 12. Следующий шаг после A

После принятия этого этапа не создаём интерфейс. Переходим к **Шагу B: Shared Contracts и JSON Schema**, затем к **Шагу C: Headless Simulation Core**.
