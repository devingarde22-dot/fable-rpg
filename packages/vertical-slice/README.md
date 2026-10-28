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

`createVerticalSliceWebSocketServer()` поднимает HTTP server с health endpoint `/health` и WebSocket endpoint `/ws`. Transport требует auth provider и campaign membership. Первый client message должен быть handshake:

```json
{"type":"hello","campaignId":"campaign-vertical-slice","role":"player","token":"player-token","actorId":"player-1"}
```

После handshake клиент отправляет команды в envelope:

```json
{"type":"command","command":{"kind":"player.move","requestId":"move-1","direction":"right"}}
```

Сервер отправляет JSON-сообщения `room.ready`, `projection`, `events`, `command.result` и `transport.error`. Projection уже отфильтрован по роли до сериализации. `room.ready` содержит одноразовый для клиента `resumeToken`; его можно передать в следующем handshake для reconnect.

Минимальный bootstrap:

```ts
import { createVerticalSliceWebSocketServer } from "@fable/vertical-slice";

const server = createVerticalSliceWebSocketServer({
  auth: new InMemoryAuthProvider(new Map([
    ["player-token", { id: "identity-player-1", roles: ["player"] }],
  ])),
  membership: new InMemoryCampaignMembershipStore([
    { campaignId: "campaign-vertical-slice", identityId: "identity-player-1", role: "player", actorId: "player-1" },
  ]),
});
await server.listen(2567, "0.0.0.0");
```

Transport пишет ошибки подключения и исключения выполнения команд как однострочные JSON-записи в `console.error`. Опция `logger` позволяет передать structured records в приложение. Записи содержат allowlisted reason codes и безопасную контекстную информацию (campaign, role, session, command kind); auth/resume tokens, raw payload, request ID и исходный `Error.message` не включаются. Непредвиденные ошибки handshake и command execution возвращают клиенту обобщённый reason code.

Transport использует стандартный пакет `ws`; Colyseus намеренно не добавлен, потому что его текущая dependency tree требует exotic git dependency `uWebSockets.js`, запрещённую policy этого repository.

## Локальная проверка

Из корня monorepo:

```bash
pnpm --filter @fable/vertical-slice test
pnpm check
pnpm build
```

## Сознательные ограничения

По умолчанию используются deny-by-default auth/membership providers. Встроенные `InMemorySlicePersistence` и `TokenBucketRateLimiter` предназначены для slice; production должен подставить DB/Redis-backed persistence и внешний identity provider. Все входящие envelopes проходят AJV JSON Schema validation до auth/command routing. Полная production hardening (JWT/OIDC verification, TLS termination и distributed rate limiting) остаётся отдельной задачей.

Если persistence store уже содержит snapshot, server можно поднять с восстановленным authoritative engine:

```ts
const server = await createVerticalSliceWebSocketServerFromPersistence({
  campaignId: "campaign-vertical-slice",
  persistence,
  restoreConfig: {
    enemyTemplates,
    intentTemplates,
    cardTemplates,
  },
  auth,
  membership,
});
```

На уровне rules package тот же механизм доступен напрямую через `HeadlessSimulationEngine.fromSnapshot(snapshot, restoreConfig)` или `createSimulationEngineFromSnapshot(...)`. Restore восстанавливает entities, active intents, input window, scene revision, server tick, sequence, phase, pause state, outcome и deterministic seed. Immutable catalogs и terrain передаются отдельно намеренно: snapshot не может подменить правила кампании.
