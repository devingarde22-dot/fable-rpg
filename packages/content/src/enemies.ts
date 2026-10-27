import type { EnemyTemplate } from "./types.js";

export const ENEMY_TEMPLATES: readonly EnemyTemplate[] = [
  {
    kind: "enemy_template",
    key: "quarantine_chaser",
    version: 1,
    status: "confirmed",
    hp: 900,
    defense: 20,
    basicAttack: { handler: "melee_strike", rawDamage: 140 },
    role: "close_combat",
    intentKeys: ["move_close", "melee_strike", "hold_position"],
    initialIntentKey: "move_close",
  },
  {
    kind: "enemy_template",
    key: "slag_shooter",
    version: 1,
    status: "confirmed",
    hp: 350,
    defense: 12,
    basicAttack: { handler: "melee_strike", rawDamage: 100 },
    role: "ranged_attack",
    intentKeys: ["ranged_shot", "reposition", "hold_position"],
    initialIntentKey: "ranged_shot",
  },
  {
    kind: "enemy_template",
    key: "extinguisher",
    version: 1,
    status: "confirmed",
    hp: 350,
    defense: 15,
    basicAttack: { handler: "melee_strike", rawDamage: 100 },
    role: "control_support",
    intentKeys: ["bind", "ally_guard", "move_close"],
  },
];

/** Only enemies whose declared active handlers are implemented are included in the runtime roster. */
export const ACTIVE_RUNTIME_ENEMY_TEMPLATE_KEYS = ["quarantine_chaser", "slag_shooter", "extinguisher"] as const;
export const ACTIVE_RUNTIME_INTENT_KEYS_BY_ENEMY = {
  quarantine_chaser: ["move_close", "melee_strike", "hold_position"],
  slag_shooter: ["ranged_shot", "hold_position"],
  extinguisher: ["bind", "ally_guard", "move_close"],
} as const;
