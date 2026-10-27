import { cellIndex, isInBounds } from "./Grid.js";
import type { Cell, CellRuntime, EngineErrorCode } from "../engine/types.js";

export type CollisionResult = { ok: true } | { ok: false; code: EngineErrorCode };

export function checkMovementDestination(
  cells: readonly CellRuntime[],
  destination: Cell,
  reservations: ReadonlySet<number> = new Set(),
): CollisionResult {
  if (!isInBounds(destination)) return { ok: false, code: "CELL_OUT_OF_BOUNDS" };
  const index = cellIndex(destination);
  const cell = cells[index];
  if (!cell) return { ok: false, code: "INVALID_STATE" };
  if (cell.blocksMovement || cell.terrain === "wall" || cell.terrain === "statue") {
    return { ok: false, code: "CELL_BLOCKED" };
  }
  if (cell.occupantId !== null || reservations.has(index)) {
    return { ok: false, code: reservations.has(index) ? "CONFLICTING_BATCH_STATE" : "CELL_OCCUPIED" };
  }
  return { ok: true };
}
