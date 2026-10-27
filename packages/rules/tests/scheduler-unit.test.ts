import { describe, expect, it } from "vitest";
import { closedWindowIdAtTick, isWindowCloseTick, windowIdAtTick } from "../src/scheduler/InputWindow.js";
import { orderCommands, phaseOrder } from "../src/scheduler/orderCommands.js";
import { moveCommand } from "./createTestEngine.js";

describe("tick scheduler", () => {
  it("closes a 250 ms window every five 50 ms ticks", () => {
    expect(windowIdAtTick(4)).toBe(0);
    expect(isWindowCloseTick(4)).toBe(false);
    expect(isWindowCloseTick(5)).toBe(true);
    expect(closedWindowIdAtTick(5)).toBe(0);
    expect(windowIdAtTick(10)).toBe(2);
    expect(closedWindowIdAtTick(10)).toBe(1);
  });

  it("orders player commands by receive sequence, actor, then request", () => {
    const ordered = orderCommands([
      moveCommand("b", "up", { sequence: 2 }),
      moveCommand("z", "up", { actorId: "actor-a", sequence: 1 }),
      moveCommand("a", "up", { actorId: "actor-a", sequence: 1 }),
    ]);
    expect(ordered.map((command) => command.requestId)).toEqual(["a", "z", "b"]);
    expect(phaseOrder()).toEqual(["players", "enemies", "environment", "resources", "cards"]);
  });
});
