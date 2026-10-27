import { cellIndex } from "../grid/Grid.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";
import type { EnemyRuntime, RuntimeState } from "./types.js";

export function cleanupDeadEnemies(state: RuntimeState, serverTick: number): PendingJournalEvent[] {
  const deadEnemies = state.scene.enemyEntityIds
    .map((enemyId) => state.entities.get(enemyId))
    .filter((entity): entity is EnemyRuntime =>
      entity?.kind === "enemy" && entity.hp.current === 0 && entity.aliveState !== "removed",
    )
    .sort((a, b) => compareText(a.id, b.id));
  const pending: PendingJournalEvent[] = [];

  for (const enemy of deadEnemies) {
    const cell = state.scene.cells[cellIndex(enemy.position)];
    if (!cell || cell.occupantId !== enemy.id) {
      throw new Error(`Enemy ${enemy.id} cannot be removed because its occupied cell is inconsistent`);
    }

    if (enemy.activeIntentId !== null) {
      const active = state.activeIntents.get(enemy.activeIntentId);
      if (!active || active.ownerEntityId !== enemy.id) {
        throw new Error(`Enemy ${enemy.id} has an invalid active intent during removal`);
      }
      active.state = "cancelled";
      active.cancelReason = "owner_removed";
      state.activeIntents.delete(active.activeIntentId);
      enemy.activeIntentId = null;
      pending.push({
        event: {
          ...eventBase(state, serverTick, enemy.id, null),
          eventType: "intent.cancelled",
          payload: { enemyId: enemy.id, activeIntentId: active.activeIntentId, reason: "owner_removed" },
          replay: null,
        },
      });
    }

    const removedCell = { x: cell.x, y: cell.y };
    cell.occupantId = null;
    enemy.aliveState = "removed";
    pending.push({
      event: {
        ...eventBase(state, serverTick, enemy.id, null),
        eventType: "scene.entity_removed",
        payload: { entityId: enemy.id, reason: "hp_depleted", cell: removedCell },
        replay: null,
      },
    });
  }

  return pending;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
