# Fable — Programming Roadmap

**Версия:** 0.1  
**Статус:** CONFIRMED PLAN  
**Цель:** довести проект от Markdown-контрактов до первого playable vertical slice.

## 0. Главный принцип порядка

Мы не начинаем с красивого TV, картинок или AI Copilot. Сначала строится маленькое детерминированное ядро, которое может проиграть одну сцену без браузера. Затем к нему подключаются сервер, сохранение и три проекции.

```text
контракты
→ simulation
→ content fixtures
→ server room
→ persistence
→ projections
→ UI
→ GM tools
→ AI Copilot
→ playtest
```

Каждый этап имеет `Definition of Done`. Следующий этап не начинается, пока предыдущий не прошёл свои проверки.

## 1. Целевой стек

Это рабочая рекомендация, а не догма:

- TypeScript — общий язык;
- pnpm workspaces — monorepo;
- Vitest — unit и simulation tests;
- Zod или Ajv — runtime validation;
- JSON Schema — межсервисные контракты;
- Colyseus или чистый WebSocket — room transport;
- PostgreSQL + Drizzle — persistence;
- React/Vite — TV, Player, GM web clients;
- Playwright — browser e2e;
- фиксированный seed — replay и deterministic tests.

## 2. Этап 0 — Source of Truth

**Цель:** превратить GDD в компактный набор файлов, которые может прочитать AI-разработчик.

### Делаем

- переносим подтверждённые правила в `docs/`;
- используем `docs/README.md` как индекс;
- проверяем термины через Glossary;
- присваиваем правилам `Rule ID`;
- помечаем старые разделы `SUPERSEDED`;
- фиксируем первый vertical slice;
- создаём Decision Record для party size, scheduler, outcome и rollback.

### Не делаем

- не пишем gameplay-код;
- не создаём все карты и города;
- не подключаем AI;
- не строим production database.

### Переход дальше

Новый AI-разработчик может прочитать пять базовых документов и описать одну сцену без уточнения базовых правил.

## 3. Этап 1 — Monorepo и инженерный каркас

**Цель:** получить воспроизводимое окружение разработки.

### Создаём

```text
apps/tv
apps/player
apps/gm
server
packages/contracts
packages/rules
packages/content
packages/test-fixtures
tests
```

Добавляем:

- `pnpm-workspace.yaml`;
- TypeScript config;
- ESLint/Prettier;
- Vitest;
- базовый CI command;
- `.env.example` без секретов;
- команду `pnpm test`, `pnpm typecheck`, `pnpm lint`.

### Acceptance

Чистый checkout запускает typecheck и пустой test suite одной командой.

## 4. Этап 2 — Shared Contracts и Schema

**Цель:** сервер, клиенты и AI используют одинаковые формы данных.

### Реализуем

- `CommandEnvelope`;
- `EventEnvelope`;
- command schema;
- event schema;
- intent schema;
- visibility annotation;
- error codes;
- типы `Scene`, `Entity`, `Card`, `Status`, `Intent`, `Checkpoint`;
- versioning для contract payload.

### Первая команда

Начинаем не с карт, а с:

```text
player.move
```

### Acceptance

- невалидный payload отклоняется до simulation;
- неизвестное поле не принимается без явного разрешения;
- TypeScript types выводятся/синхронизированы со Schema;
- контракт имеет минимум один valid и один invalid fixture.

## 5. Этап 3 — Headless Simulation Core

**Это первый настоящий программный этап.**

**Цель:** проиграть клеточную сцену без UI, WebSocket и базы данных.

### Реализуем по порядку

1. координаты и grid 9×9;
2. blocked cells и occupied cells;
3. entity registry;
4. режимы героя;
5. перемещение;
6. server tick 20 Hz;
7. input window 250 мс;
8. ordering: players → enemies → environment;
9. HP и stamina;
10. card filter и card cost;
11. status layers;
12. intent timer;
13. target selection по seed;
14. event journal in memory;
15. replay из event sequence.

### Не реализуем

- React;
- картинки и анимации;
- real PostgreSQL;
- AI;
- полную колоду.

### Acceptance

Headless test запускает сцену, в которой герой двигается, враг приближается, intent завершается, карта наносит урон, статус истекает и replay воспроизводит тот же результат.

## 6. Этап 4 — Content Fixtures первого среза

**Цель:** наполнить ядро фиксированными данными, а не генераторами.

### Создаём fixtures

- 4 игрока;
- 3 героя для debug smoke test;
- 3 врага: преследователь, стрелок, Погаситель;
- карта 9×9;
- 2 стены;
- 1 статуя/баррикада;
- 5–7 карт на тестовый герой;
- 1 defense card;
- `Immobilized`;
- `Ally Guard`;
- один consequence;
- outcomes success, retreat, defeat, gm_abort.

### Правило

Контент vertical slice хранится в JSON/TS fixtures и валидируется Schema. AI не генерирует числа во время запуска сцены.

### Acceptance

Одна команда `run:vertical-slice` загружает стабильные fixtures и проходит headless-сцену с фиксированным seed.

## 7. Этап 5 — Authoritative Server Room

**Цель:** подключить реальное время без переноса правил в клиенты.

### Реализуем

- create/join room;
- роли TV, Player, GM;
- campaign/scene membership;
- command router;
- auth и ownership checks;
- requestId idempotency;
- sceneRevision;
- 250ms batch;
- server broadcast;
- safe errors;
- reconnect snapshot;
- presence.

### Критически важно

Сначала подключается только одна команда `player.move`, затем `player.play_card`, затем intents. Не реализуем все команды комнаты одновременно.

### Acceptance

Два игрока могут отправить действия почти одновременно, сервер выдаёт одинаковый порядок всем подключённым устройствам, stale command не меняет state.

## 8. Этап 6 — Persistence и Checkpoint

**Цель:** сервер переживает reconnect и может восстановить состояние.

### Реализуем

- Drizzle schema;
- migrations;
- campaigns, sessions, scenes;
- scene entities;
- command requests;
- append-only campaign events;
- checkpoints;
- rollback audit;
- reward idempotency;
- transaction boundaries.

### Порядок

1. Сначала сохраняем event journal.
2. Затем snapshot scene.
3. Затем создаём checkpoint перед сценой.
4. Затем тестируем rollback.
5. Только потом добавляем campaign-level lore persistence.

### Acceptance

После остановки/переподключения room получает snapshot. Rollback полностью возвращает состояние checkpoint и не выдаёт reward повторно.

## 9. Этап 7 — Filtered Projections

**Цель:** один server state превращается в четыре безопасные проекции.

### Создаём

- `TvProjection`;
- `PlayerProjection`;
- `GmProjection`;
- `AiContextProjection`.

### Проверяем

- Player не видит чужую руку;
- TV не видит exact target и seed;
- GM видит все данные;
- AI получает только packet;
- private hint приходит только нужному Player.

### Acceptance

Visibility negative tests проходят для snapshot, event, error, reconnect и animation payload.

## 10. Этап 8 — Минимальные web clients

Порядок интерфейсов важен:

### 8.1 Player

Сначала только:

- подключение;
- стрелки;
- HP;
- стамина;
- 5 карт;
- defense slot;
- кнопка movement;
- кнопка ranged mode;
- target selection;
- private hint с вибрацией.

### 8.2 TV

Затем:

- grid;
- entities;
- blocked cells;
- movement animation;
- intent icon;
- timer ring;
- red ranged target cell;
- red AOE area;
- public outcome.

### 8.3 GM

После этого:

- полный scene state;
- exact intent;
- entity inspector;
- consequence picker;
- end expedition;
- checkpoint;
- rollback confirmation;
- private hint;
- journal.

### Acceptance

Все три клиента работают с одной сценой и не содержат собственной игровой логики.

## 11. Этап 9 — GM Tools

**Цель:** сделать игру управляемой ведущим, а не только автоматическим тестом.

### Реализуем

- spawn proposal;
- NPC/entity inspector;
- HP/status override с audit;
- consequence editor;
- scene transfer;
- private hints;
- pause;
- manual expedition end;
- checkpoint selector;
- rollback warning;
- event journal.

### Ограничение

GM editor не пишет напрямую в БД. Он отправляет команду, которую сервер валидирует и журналирует.

## 12. Этап 10 — AI Copilot

AI подключается только после работающего vertical slice.

### Первая версия умеет

- читать разрешённый context packet;
- искать противоречия;
- предлагать описание сцены;
- предлагать 2–5 последствий;
- предлагать NPC spawn;
- проверять lore consistency;
- готовить private hint draft;
- возвращать JSON Schema-valid proposal.

### Первая версия не умеет

- применять команды;
- выбирать итог сцены;
- менять HP или карты;
- выбирать random outcome;
- вести диалог без GM;
- читать весь campaign state.

### Acceptance

AI proposal появляется у GM, проходит Schema validation, требует confirmation и после подтверждения превращается в обычное серверное событие.

## 13. Этап 11 — Первый playtest

### Сессии

Провести минимум 3 сессии:

1. техническая: команда и reconnect;
2. rules: бой, intent, cards, stamina;
3. GM: consequence, hint, checkpoint, rollback.

### Метрики

- длительность сцены;
- время понимания red telegraph;
- количество stale commands;
- количество rejected commands;
- рассинхронизации;
- visibility leakage;
- время rollback;
- DPS и damage taken;
- количество вопросов игроков к интерфейсу.

После playtest меняются tuning values, а не базовые contracts без Decision Record.

## 14. Этап 12 — Расширение после slice

Только после принятия среза добавляются:

- дополнительные узлы;
- остальные города Аверенн;
- faction reputation;
- социальная реакция экипировки;
- AI-assisted dialogue;
- боссы и фазы;
- новые карты и статусы;
- полноценная кампания;
- production authentication и deployment.

## 15. Три ближайшие задачи

### Задача A — Setup

Создать monorepo, TypeScript, tests, contracts package и команду CI.

### Задача B — Move simulation

Реализовать grid, `player.move`, blocked/occupied cells, event journal и golden tests.

### Задача C — Intent simulation

Добавить `move_close`, `melee_strike`, `ranged_shot`, 20 Hz timer, 250ms input window и deterministic seed.

После C можно подключать WebSocket. До C UI делать не нужно.

## 16. Programming Definition of Done

Программный vertical slice готов, когда:

- чистый checkout запускается одной командой;
- headless simulation проходит fixed seed;
- 4 Player clients, TV и GM подключаются к одной room;
- server ordering воспроизводим;
- карты, HP, stamina, statuses и intents работают;
- TV показывает icon и red target cell;
- Player видит только свою projection;
- GM может завершить сцену, создать checkpoint и выполнить rollback;
- journal и replay воспроизводят результат;
- AI Copilot остаётся предложением и не может сам изменить state;
- все acceptance tests проходят.
