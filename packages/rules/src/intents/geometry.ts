import { cellIndex, isInBounds } from "../grid/Grid.js";
import { checkMovementDestination } from "../grid/collision.js";
import type { Cell, CellRuntime, EntityRuntime } from "../engine/types.js";

export function chebyshevDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function hasLineOfSight(cells: readonly CellRuntime[], from: Cell, to: Cell): boolean {
  if (!isInBounds(from) || !isInBounds(to)) return false;
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;

  while (x !== to.x || y !== to.y) {
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
    if (x === to.x && y === to.y) break;
    const cell = cells[cellIndex({ x, y })];
    if (!cell || cell.blocksLineOfSight) return false;
  }
  return true;
}

export function nextGreedyPathCell(
  cells: readonly CellRuntime[],
  enemy: EntityRuntime,
  target: EntityRuntime,
): Cell | null {
  const currentDistance = manhattanDistance(enemy.position, target.position);
  if (chebyshevDistance(enemy.position, target.position) <= 1) return null;
  const candidates: readonly Cell[] = [
    { x: enemy.position.x, y: enemy.position.y - 1 },
    { x: enemy.position.x - 1, y: enemy.position.y },
    { x: enemy.position.x + 1, y: enemy.position.y },
    { x: enemy.position.x, y: enemy.position.y + 1 },
  ];
  for (const candidate of candidates) {
    if (!checkMovementDestination(cells, candidate).ok) continue;
    if (manhattanDistance(candidate, target.position) < currentDistance) return candidate;
  }
  return null;
}

function manhattanDistance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
