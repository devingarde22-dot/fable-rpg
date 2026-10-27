import { describe, expect, it } from "vitest";
import { createSimulationEngine } from "../src/engine/SimulationEngine.js";
import { canAffordStamina } from "../src/resources/stamina.js";
import { hero, testConfig } from "./createTestEngine.js";

describe("stamina rules", () => {
  it("allows zero cost at zero stamina and rejects unaffordable positive costs", () => {
    expect(canAffordStamina(0, 0)).toBe(true);
    expect(canAffordStamina(0, 1)).toBe(false);
    expect(canAffordStamina(2, 2)).toBe(true);
    expect(canAffordStamina(2, 3)).toBe(false);
  });

  it("rejects invalid resource values and costs", () => {
    expect(canAffordStamina(-1, 0)).toBe(false);
    expect(canAffordStamina(1.5, 1)).toBe(false);
    expect(canAffordStamina(1, -1)).toBe(false);
    expect(canAffordStamina(1, 0.5)).toBe(false);
  });

  it("starts heroes with 3 stamina and takes max stamina from the runtime config", () => {
    const engine = createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false, 5)],
      heroIdByActorId: { "actor-1": "hero-1" },
    }));
    const runtimeHero = engine.snapshot().entities.find((entity) => entity.id === "hero-1");
    expect(runtimeHero).toMatchObject({
      kind: "hero",
      stamina: { current: 3, max: 5, nextRegenAtTick: 300 },
    });
  });

  it("rejects a configured maximum below the starting stamina", () => {
    expect(() => createSimulationEngine(testConfig({
      entities: [hero("hero-1", 1, 1, "movement", false, 2)],
      heroIdByActorId: { "actor-1": "hero-1" },
    }))).toThrow(/must start with 3 stamina and a sufficient maximum/);
  });
});
