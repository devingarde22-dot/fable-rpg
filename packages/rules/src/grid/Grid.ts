import {
  GRID_HEIGHT,
  GRID_WIDTH,
  type Cell,
  type CellRuntime,
  type Terrain,
} from "../engine/types.js";

export function isInBounds(cell: Cell): boolean {
  return Number.isInteger(cell.x) && Number.isInteger(cell.y) &&
    cell.x >= 0 && cell.x < GRID_WIDTH && cell.y >= 0 && cell.y < GRID_HEIGHT;
}

export function cellIndex(cell: Cell): number {
  if (!isInBounds(cell)) throw new RangeError(`Cell (${cell.x}, ${cell.y}) is outside the grid`);
  return cell.y * GRID_WIDTH + cell.x;
}

export function createGrid(
  terrainOverrides: readonly { cell: Cell; terrain: Terrain }[] = [],
): CellRuntime[] {
  const terrainByIndex = new Map<number, Terrain>();
  for (const entry of terrainOverrides) {
    const index = cellIndex(entry.cell);
    if (terrainByIndex.has(index)) throw new Error(`Duplicate terrain override at ${entry.cell.x},${entry.cell.y}`);
    terrainByIndex.set(index, entry.terrain);
  }

  const cells: CellRuntime[] = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const terrain = terrainByIndex.get(y * GRID_WIDTH + x) ?? "floor";
      const blocksMovement = terrain === "wall" || terrain === "statue";
      cells.push({
        x,
        y,
        terrain,
        blocksMovement,
        blocksLineOfSight: terrain === "wall" || terrain === "statue",
        occupantId: null,
      });
    }
  }
  return cells;
}

export function cloneCell(cell: Cell): Cell {
  return { x: cell.x, y: cell.y };
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}
