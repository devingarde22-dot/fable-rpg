import { describe, expect, it } from "vitest";
import { cellIndex, createGrid, isInBounds } from "../src/grid/Grid.js";

describe("9×9 grid", () => {
  it("creates 81 row-major floor cells with canonical coordinates", () => {
    const grid = createGrid();
    expect(grid).toHaveLength(81);
    expect(grid[0]).toMatchObject({ x: 0, y: 0, terrain: "floor" });
    expect(grid[80]).toMatchObject({ x: 8, y: 8, terrain: "floor" });
    expect(cellIndex({ x: 8, y: 8 })).toBe(80);
  });

  it("checks inclusive grid bounds and rejects non-integers", () => {
    expect(isInBounds({ x: 0, y: 0 })).toBe(true);
    expect(isInBounds({ x: 8, y: 8 })).toBe(true);
    expect(isInBounds({ x: -1, y: 0 })).toBe(false);
    expect(isInBounds({ x: 9, y: 8 })).toBe(false);
    expect(isInBounds({ x: 1.5, y: 2 })).toBe(false);
  });

  it("marks wall and statue as movement and LoS blockers", () => {
    const grid = createGrid([
      { cell: { x: 2, y: 3 }, terrain: "wall" },
      { cell: { x: 4, y: 5 }, terrain: "statue" },
    ]);
    expect(grid[cellIndex({ x: 2, y: 3 })]).toMatchObject({ blocksMovement: true, blocksLineOfSight: true });
    expect(grid[cellIndex({ x: 4, y: 5 })]).toMatchObject({ terrain: "statue", blocksMovement: true });
  });
});
