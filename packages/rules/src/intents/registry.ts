import { IMMOBILIZED_DURATION_MS, type EnemyTemplate, type IntentTemplate } from "../engine/types.js";

export const ACTIVE_INTENT_HANDLERS = new Set(["move_close", "melee_strike", "ranged_shot", "hold_position", "bind"]);

export function buildIntentRegistry(templates: readonly IntentTemplate[]): Map<string, IntentTemplate> {
  const registry = new Map<string, IntentTemplate>();
  for (const template of templates) {
    if (!template.key || registry.has(template.key)) throw new Error(`Duplicate or empty intent template key: ${template.key}`);
    if (template.durationMs < 3_000 || template.durationMs % 50 !== 0) {
      throw new Error(`Invalid durationMs for intent template ${template.key}`);
    }
    if (template.effect.handler === "bind" &&
      (template.effect.parameters.statusKey !== "immobilized" || template.effect.parameters.durationMs !== IMMOBILIZED_DURATION_MS)) {
      throw new Error(`Bind intent ${template.key} must apply immobilized for ${IMMOBILIZED_DURATION_MS} ms`);
    }
    const range = template.targetRules.range;
    if (range && range.minInclusive > range.maxInclusive) throw new Error(`Invalid range for intent template ${template.key}`);
    registry.set(template.key, cloneIntentTemplate(template));
  }
  for (const template of registry.values()) {
    for (const fallbackKey of template.fallbackKeys) {
      if (!registry.has(fallbackKey)) throw new Error(`Unknown fallback intent ${fallbackKey} in ${template.key}`);
    }
  }
  return registry;
}

export function buildEnemyRegistry(
  templates: readonly EnemyTemplate[],
  intents: ReadonlyMap<string, IntentTemplate>,
): Map<string, EnemyTemplate> {
  const registry = new Map<string, EnemyTemplate>();
  for (const template of templates) {
    if (!template.key || registry.has(template.key)) throw new Error(`Duplicate or empty enemy template key: ${template.key}`);
    if (!Number.isInteger(template.hp) || template.hp <= 0 || !Number.isFinite(template.defense) || template.defense < 0) {
      throw new Error(`Invalid stats in enemy template ${template.key}`);
    }
    if (template.basicAttack.handler !== "melee_strike" || !Number.isFinite(template.basicAttack.rawDamage) || template.basicAttack.rawDamage <= 0) {
      throw new Error(`Invalid basic attack in enemy template ${template.key}`);
    }
    for (const intentKey of template.intentKeys) {
      const intent = intents.get(intentKey);
      if (!intent) throw new Error(`Unknown intent ${intentKey} in enemy template ${template.key}`);
    }
    if (template.initialIntentKey && !template.intentKeys.includes(template.initialIntentKey)) {
      throw new Error(`Initial intent ${template.initialIntentKey} is not registered by enemy ${template.key}`);
    }
    registry.set(template.key, {
      ...template,
      basicAttack: { ...template.basicAttack },
      intentKeys: [...template.intentKeys],
    });
  }
  return registry;
}

export function cloneIntentTemplate(template: IntentTemplate): IntentTemplate {
  return structuredClone(template);
}
