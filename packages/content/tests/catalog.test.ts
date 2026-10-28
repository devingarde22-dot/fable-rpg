import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { ACTIVE_RUNTIME_ENEMY_TEMPLATE_KEYS, ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY, ENEMY_TEMPLATES, INTENT_TEMPLATES } from "../src/index.js";

const intentSchema = JSON.parse(
  readFileSync(new URL("../../contracts/intent.schema.json", import.meta.url), "utf8"),
) as object;
const enemySchema = JSON.parse(
  readFileSync(new URL("../../contracts/enemy.schema.json", import.meta.url), "utf8"),
) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateIntent = ajv.compile(intentSchema);
const validateEnemy = ajv.compile(enemySchema);

describe("validated content catalog", () => {
  it("validates all catalog intent templates against the canonical JSON Schema", () => {
    for (const template of INTENT_TEMPLATES) {
      expect(validateIntent(template), JSON.stringify(validateIntent.errors)).toBe(true);
      expect(template.durationMs).toBeGreaterThanOrEqual(3000);
      expect(template.durationMs % 50).toBe(0);
    }
    const bind = INTENT_TEMPLATES.find((template) => template.key === "bind");
    expect(bind?.version).toBe(2);
    expect(bind?.durationMs).toBe(12_000);
    expect(bind?.effect.parameters.durationMs).toBe(15_000);
    expect(bind?.targetRules.filters.excludedStatuses).toContain("immobilized");
  });

  it("rejects durations that are below the minimum or not aligned to 50 ms", () => {
    const source = INTENT_TEMPLATES[0];
    if (!source) throw new Error("move_close content template missing");
    expect(validateIntent({ ...source, durationMs: 2_950 })).toBe(false);
    expect(validateIntent({ ...source, durationMs: 3_025 })).toBe(false);
  });

  it("validates enemy templates and explicit retreat basic attacks against the canonical schema", () => {
    for (const template of ENEMY_TEMPLATES) {
      expect(validateEnemy(template), JSON.stringify(validateEnemy.errors)).toBe(true);
    }
    expect(ENEMY_TEMPLATES.map(({ key, basicAttack }) => [key, basicAttack])).toEqual([
      ["quarantine_chaser", { handler: "melee_strike", rawDamage: 140 }],
      ["slag_shooter", { handler: "melee_strike", rawDamage: 100 }],
      ["extinguisher", { handler: "melee_strike", rawDamage: 100 }],
    ]);
    const template = ENEMY_TEMPLATES[0];
    if (!template) throw new Error("quarantine_chaser content template missing");
    expect(validateEnemy({ ...template, basicAttack: { handler: "ranged_shot", rawDamage: 140 } })).toBe(false);
  });

  it("registers all three enemies and activates the implemented extinguisher handlers", () => {
    expect(ENEMY_TEMPLATES.map((template) => template.key)).toEqual([
      "quarantine_chaser",
      "slag_shooter",
      "extinguisher",
    ]);
    expect(ACTIVE_RUNTIME_ENEMY_TEMPLATE_KEYS).toEqual(["quarantine_chaser", "slag_shooter", "extinguisher"]);
    expect(ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY.quarantine_chaser).toEqual(["move_close", "melee_strike", "hold_position"]);
    expect(ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY.slag_shooter).toEqual(["ranged_shot", "hold_position"]);
    expect(ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY.extinguisher).toEqual(["bind", "ally_guard", "move_close", "hold_position"]);
    expect(ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY.extinguisher).not.toContain("reposition");
  });

  it("only references registered templates and does not use deferred reposition as a fallback", () => {
    const intentKeys = new Set<string>(INTENT_TEMPLATES.map((template) => template.key));
    for (const enemy of ENEMY_TEMPLATES) {
      for (const key of enemy.intentKeys) expect(intentKeys.has(key)).toBe(true);
      if (enemy.initialIntentKey) expect(enemy.intentKeys).toContain(enemy.initialIntentKey);
    }
    for (const template of INTENT_TEMPLATES) {
      expect(template.fallbackKeys).not.toContain("reposition");
    }
    expect(INTENT_TEMPLATES.find((template) => template.key === "reposition")?.status).toBe("draft");
    expect(ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY.slag_shooter).not.toContain("reposition");
    expect(intentKeys.has("hold_position")).toBe(true);
  });
});
