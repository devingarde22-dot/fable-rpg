import { describe, expect, it } from "vitest";
import { createRuntimeState } from "../src/engine/createRuntimeState.js";
import { assertRuntimeInvariants } from "../src/engine/invariants.js";
import { enemy, hero, testConfig } from "./createTestEngine.js";

describe("runtime invariants", () => {
  it("accepts a canonical runtime state", () => {
    expect(() => createRuntimeState(testConfig())).not.toThrow();
  });

  it("detects duplicate cell occupancy for an active entity", () => {
    const state = createRuntimeState(testConfig());
    const heroCell = state.scene.cells.find((cell) => cell.occupantId === "hero-1");
    const freeCell = state.scene.cells.find((cell) => cell.occupantId === null);
    if (!heroCell || !freeCell) throw new Error("fixture cells missing");
    freeCell.occupantId = "hero-1";
    expect(() => assertRuntimeInvariants(state)).toThrow(/multiple cells/);
  });

  it("rejects overlapping fixture entities and entities placed on blocked terrain", () => {
    expect(() => createRuntimeState(testConfig({
      entities: [
        hero("a", 1, 1),
        enemy("b", 1, 1),
      ],
    }))).toThrow(/overlap/);
    expect(() => createRuntimeState(testConfig({
      terrain: [{ cell: { x: 1, y: 1 }, terrain: "wall" }],
    }))).toThrow(/blocked terrain/);
  });
});
