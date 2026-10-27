import { checkMovementDestination } from "../grid/collision.js";
import { cellIndex } from "../grid/Grid.js";
import type { Cell, CellRuntime, Direction, EngineErrorCode } from "../engine/types.js";

const DELTAS: Readonly<Record<Direction, Cell>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function calculateDestination(position: Cell, direction: Direction): Cell {
  const delta = DELTAS[direction];
  if (!delta) throw new TypeError("Unsupported movement direction");
  return { x: position.x + delta.x, y: position.y + delta.y };
}

export function validateMove(
  cells: readonly CellRuntime[],
  from: Cell,
  direction: Direction,
  reservations: ReadonlySet<number> = new Set(),
): { ok: true; destination: Cell; fromIndex: number; toIndex: number } | { ok: false; code: EngineErrorCode } {
  const destination = calculateDestination(from, direction);
  const collision = checkMovementDestination(cells, destination, reservations);
  if (!collision.ok) return collision;
  return { ok: true, destination, fromIndex: cellIndex(from), toIndex: cellIndex(destination) };
}
