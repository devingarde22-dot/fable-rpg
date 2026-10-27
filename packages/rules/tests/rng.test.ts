import { describe, expect, it } from "vitest";
import { RNG_ALGORITHM_VERSION, type RngForkInput } from "../src/engine/types.js";
import { DeterministicRng } from "../src/rng/DeterministicRng.js";

const baseInput: RngForkInput = {
  rootSeed: "тестовый-seed",
  campaignId: "campaign-α",
  sceneId: "scene-01",
  serverTick: 20,
  activeIntentId: "scene-01:enemy-01:20:ranged_shot",
  purpose: "target_selection",
};

describe("versioned deterministic RNG", () => {
  it("uses the confirmed algorithm version and deterministically derives UTF-8 fork seeds", () => {
    const first = DeterministicRng.fork(baseInput);
    const repeat = DeterministicRng.fork(baseInput);
    expect(RNG_ALGORITHM_VERSION).toBe("fable.rng.v1");
    expect(first.seedRef).toMatch(/^[0-9a-f]{64}$/);
    expect(repeat.seedRef).toBe(first.seedRef);
    expect(first.state()).toEqual(repeat.state());
    expect(first.nextUint32()).toBe(repeat.nextUint32());
  });

  it("isolates purpose and tick forks", () => {
    const fallback = DeterministicRng.fork({ ...baseInput, purpose: "fallback_selection" });
    const nextTick = DeterministicRng.fork({ ...baseInput, serverTick: baseInput.serverTick + 1 });
    expect(fallback.seedRef).not.toBe(DeterministicRng.fork(baseInput).seedRef);
    expect(nextTick.seedRef).not.toBe(DeterministicRng.fork(baseInput).seedRef);
  });

  it("returns bounded integers in range and rejects invalid bounds", () => {
    const rng = DeterministicRng.fork(baseInput);
    const draws = Array.from({ length: 100 }, () => rng.nextInt(7));
    expect(draws.every((value) => Number.isInteger(value) && value >= 0 && value < 7)).toBe(true);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
  });
});
