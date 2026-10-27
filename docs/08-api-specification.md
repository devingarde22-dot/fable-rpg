# Fable — API Specification

> **Step B baseline precedence:** wire-level decisions in [04-step-b-baseline.md](./04-step-b-baseline.md) supersede older generic payload examples in this document. Use the typed JSON Schemas under `../packages/contracts/`.

**Версия:** 0.1  
**Статус:** IMPLEMENTATION BASELINE  
**Transport:** HTTPS JSON + WebSocket/Colyseus room

## 1. API principles

- REST используется для auth/session/content/checkpoint read.
- WebSocket используется для real-time commands/events.
- Сервер валидирует каждую команду через Schema и текущий state.
- AI Copilot доступен только backend.
- GM state-changing commands требуют подтверждения.
- Все endpoints имеют `requestId` или `Idempotency-Key`, если операция меняет state.

## 2. HTTP endpoints

### `POST /api/v1/sessions`

Создаёт или возобновляет игровую сессию.

Request:

```json
{
  "campaignId": "camp_01",
  "role": "gm",
  "playerId": null
}
```

Response:

```json
{
  "sessionId": "sess_01",
  "roomId": "room_01",
  "role": "gm",
  "expiresAt": "2026-10-27T12:00:00Z"
}
```

### `GET /api/v1/campaigns/:campaignId`

Возвращает filtered campaign summary согласно роли. Player не получает GM-only lore и hidden route data.

### `GET /api/v1/campaigns/:campaignId/checkpoints`

GM-only список checkpoint без передачи скрытого содержимого Player-клиенту.

### `GET /api/v1/scenes/:sceneId/snapshot`

Возвращает filtered snapshot с `sceneRevision`. Для reconnect клиент должен использовать этот endpoint или room resume protocol.

### `POST /api/v1/gm/proposals/:proposalId/confirm`

GM подтверждает proposal AI/GM editor. Backend повторно валидирует payload и права перед транзакцией.

### `POST /api/v1/gm/rollback`

GM-only, требует `confirmationToken` и reason. Возвращает новый `sceneRevision` и `rollbackEventId`.

## 3. WebSocket room

### Join

```json
{
  "type": "room.join",
  "campaignId": "camp_01",
  "sceneId": "scene_01",
  "role": "player",
  "playerId": "player_02",
  "resumeFromRevision": 41
}
```

Server validates campaign membership, role, player ownership and scene access. После join sends `room.ready` and filtered snapshot.

### Client commands

```text
player.move
player.play_card
player.enter_movement_mode
player.enter_ranged_mode
gm.send_hint
gm.apply_consequence
gm.end_expedition
gm.create_checkpoint
gm.rollback_to_checkpoint
gm.pause_scene
```

### Server events

```text
room.ready
snapshot.received
command.accepted
command.rejected
scene.entity_moved
scene.mode_changed
card.drawn
card.played
stamina.changed
hp.changed
status.applied
status.expired
intent.started
intent.cancelled
intent.resolved
scene.spawn_accent
scene.spawn_applied
hint.sent
checkpoint.created
rollback.applied
expedition.ended
```

## 4. Command lifecycle

```text
client command
→ transport auth
→ schema validation
→ role/ownership validation
→ requestId idempotency
→ sceneRevision validation
→ 250ms batch
→ deterministic simulation
→ event journal transaction
→ filtered broadcast
→ command result
```

## 5. Error response

```json
{
  "ok": false,
  "requestId": "req_01",
  "code": "STALE_SCENE_REVISION",
  "sceneRevision": 42,
  "safeMessage": "Состояние сцены изменилось. Обновите экран."
}
```

`safeMessage` не содержит exact target, GM-only reason, seed, чужую карту или скрытое условие.

## 6. AI Copilot API

### `POST /api/v1/copilot/proposals`

Backend-only. Request contains only allowed context packet:

```json
{
  "requestId": "ai_req_01",
  "campaignId": "camp_01",
  "sceneId": "scene_01",
  "rulesetVersion": "fable-0.1",
  "context": {
    "publicFacts": [],
    "gmFacts": [],
    "recentEvents": [],
    "availableTemplates": []
  },
  "request": "Предложи два последствия поражения."
}
```

Response must have `confirmationRequired: true` and status `proposed`, `needs_clarification` or `rejected`. AI never receives `apply_consequence` or `apply_spawn`.

### `POST /api/v1/copilot/proposals/:id/confirm`

GM-only. Server validates the proposal against current sceneRevision, Schema, permissions and content references before creating events.

## 7. Rate limits and safety

- Player commands: server-configured per-session rate limit.
- GM editor: rate limited but usable during scene.
- AI: backend API key only; no browser key.
- Copilot response timeout creates no state change.
- All AI requests store promptVersion, modelId, contextHash and result status in audit.

## 8. API acceptance

- Player cannot call GM endpoint.
- GM cannot impersonate another player without explicit debug permission.
- Stale commands never mutate state.
- Retry with same requestId is idempotent.
- Event broadcast is derived from committed state, not optimistic client state.
- AI timeout/failure never blocks ordinary battle commands.
- Reconnect receives a filtered snapshot and active timers.
