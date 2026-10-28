# Fable player/GM vertical slice

`@fable/vertical-slice` — минимальный in-memory adapter поверх `@fable/rules`. Он показывает полный серверный поток без UI и внешней сети:

```text
player command → role check → HeadlessSimulationEngine → domain events → role-filtered projection
GM command     → role check → pause/outcome control → projections
```

## Что входит

- два player actor (`player-1`, `player-2`) и один GM;
- authoritative `HeadlessSimulationEngine`;
- player projection с собственным hero и enemy entities;
- GM projection со всеми entities и active intents;
- `player.move` через реальный 250 ms input window;
- GM pause/resume;
- GM expedition outcome;
- event broadcast и command result;
- integration tests на role checks, visibility, movement, pause и outcome.

## WebSocket transport

`createVerticalSliceWebSocketServer()` поднимает HTTP server с health endpoint `/health` и WebSocket endpoint `/ws`. Первый client message должен быть handshake:

```json
{"type":"hello","role":"player","actorId":"player-1"}
```

После handshake клиент отправляет команды в envelope:

```json
{"type":"command","command":{"kind":"player.move","requestId":"move-1","direction":"right"}}
```

Сервер отправляет JSON-сообщения `room.ready`, `projection`, `events`, `command.result` и `transport.error`. Projection уже отфильтрован по роли до сериализации.

Минимальный bootstrap:

```ts
import { createVerticalSliceWebSocketServer } from "@fable/vertical-slice";

const server = createVerticalSliceWebSocketServer();
await server.listen(2567, "0.0.0.0");
```

Transport использует стандартный пакет `ws`; Colyseus намеренно не добавлен, потому что его текущая dependency tree требует exotic git dependency `uWebSockets.js`, запрещённую policy этого repository.

## Локальная проверка

Из корня monorepo:

```bash
pnpm --filter @fable/vertical-slice test
pnpm check
pnpm build
```

## Сознательные ограничения

Это не production transport и не UI. Нет авторизации, persistence, reconnect, rate limiting или полной JSON Schema validation внешнего сообщения. Следующим шагом можно добавить auth/session membership и persistence, не перенося gameplay-логику из `HeadlessSimulationEngine`.
