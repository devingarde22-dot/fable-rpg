import { describe, expect, it } from "vitest";
import { checkMovementDestination } from "../src/grid/collision.js";
import { cellIndex, createGrid } from "../src/grid/Grid.js";

describe("movement collision", () => {
  it("rejects cells outside the grid", () => {
    expect(checkMovementDestination(createGrid(), { x: 9, y: 2 })).toEqual({ ok: false, code: "CELL_OUT_OF_BOUNDS" });
  });

  it.each(["wall", "statue"] as const)("rejects %s terrain", (terrain) => {
    const grid = createGrid([{ cell: { x: 2, y: 2 }, terrain }]);
    expect(checkMovementDestination(grid, { x: 2, y: 2 })).toEqual({ ok: false, code: "CELL_BLOCKED" });
  });

  it("rejects another hero or enemy occupying a cell", () => {
    const grid = createGrid();
    const index = cellIndex({ x: 3, y: 3 });
    const cell = grid[index];
    if (!cell) throw new Error("test cell missing");
    cell.occupantId = "enemy-1";
    expect(checkMovementDestination(grid, { x: 3, y: 3 })).toEqual({ ok: false, code: "CELL_OCCUPIED" });
  });

  it("rejects a destination reserved earlier in the batch", () => {
    const grid = createGrid();
    const index = cellIndex({ x: 3, y: 3 });
    expect(checkMovementDestination(grid, { x: 3, y: 3 }, new Set([index]))).toEqual({ ok: false, code: "CONFLICTING_BATCH_STATE" });
  });
});
