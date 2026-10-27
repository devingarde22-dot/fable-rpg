export type TargetPolicy =
  | "none"
  | "nearest_player"
  | "current_target"
  | "highest_threat"
  | "nearest_visible_player"
  | "lowest_ally_hp_percentage";

export type IntentPrecondition = "target_available" | "path_exists" | "melee_contact";

export type IntentEffect =
  | { handler: "move_close"; parameters: Record<string, never> }
  | { handler: "melee_strike"; parameters: { rawDamage: number } }
  | { handler: "ranged_shot"; parameters: { rawDamage: number } }
  | { handler: "reposition"; parameters: Record<string, never> }
  | { handler: "hold_position"; parameters: Record<string, never> }
  | { handler: "bind"; parameters: { statusKey: "immobilized"; durationMs: number } }
  | { handler: "ally_guard"; parameters: { defenseBonusPercent: number; durationMs: number } };

export type IntentTemplate = {
  kind: "intent_template";
  key: string;
  version: number;
  status: "draft" | "confirmed" | "deprecated";
  icon: string;
  durationMs: number;
  conditions: { preconditions: readonly IntentPrecondition[] };
  effect: IntentEffect;
  targetRules: {
    policy: TargetPolicy;
    fallbackPolicies: readonly TargetPolicy[];
    range: null | { minInclusive: number; maxInclusive: number };
    lineOfSight: "required" | "not_required";
    filters: {
      factions: readonly ("party" | "enemy" | "neutral")[];
      aliveStates: readonly ("active" | "unconscious" | "critically_injured" | "removed")[];
      requiredStatuses: readonly string[];
      excludedStatuses: readonly string[];
    };
  };
  fallbackKeys: readonly string[];
  visibility: "public" | "conditional" | "gm_only";
  revealPolicy?: {
    visibility: "conditional";
    revealKey: string;
    revealEventType: string;
  };
};

export type EnemyTemplate = {
  kind: "enemy_template";
  key: string;
  version: number;
  status: "draft" | "confirmed" | "deprecated";
  hp: number;
  defense: number;
  basicAttack: { handler: "melee_strike"; rawDamage: number };
  role: string;
  intentKeys: readonly string[];
  initialIntentKey?: string;
};
