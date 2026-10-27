import type { ActiveIntent, EntityRuntime, IntentTemplate, RuntimeState } from "../engine/types.js";
import { chebyshevDistance, hasLineOfSight, nextGreedyPathCell } from "./geometry.js";
import { isEligibleTarget, selectIntentTarget } from "./targeting.js";
import { ACTIVE_INTENT_HANDLERS } from "./registry.js";

export type IntentValidation =
  | { ok: true; target: EntityRuntime | null }
  | { ok: false; reason: "target_invalid" | "path_blocked" | "los_blocked" | "no_longer_possible" };

export function validateIntent(
  state: RuntimeState,
  enemy: EntityRuntime,
  template: IntentTemplate,
  intentId: string,
  currentTargetId: string | null = null,
): IntentValidation {
  if (enemy.kind !== "enemy" || enemy.aliveState !== "active" || enemy.hp.current === 0) {
    return { ok: false, reason: "no_longer_possible" };
  }
  if (!ACTIVE_INTENT_HANDLERS.has(template.effect.handler)) return { ok: false, reason: "no_longer_possible" };
  if (template.effect.handler === "hold_position") return { ok: true, target: null };

  const selected = selectIntentTarget(state, enemy, template, intentId, currentTargetId);
  if (!selected) {
    if (template.targetRules.lineOfSight === "required") return { ok: false, reason: "los_blocked" };
    return { ok: false, reason: "target_invalid" };
  }
  const target = selected.target;
  if (!isEligibleTarget(state.scene.cells, enemy, target, template)) return { ok: false, reason: "target_invalid" };
  if (template.targetRules.lineOfSight === "required" && !hasLineOfSight(state.scene.cells, enemy.position, target.position)) {
    return { ok: false, reason: "los_blocked" };
  }

  for (const condition of template.conditions.preconditions) {
    if (condition === "target_available" && target.aliveState !== "active") return { ok: false, reason: "target_invalid" };
    if (condition === "melee_contact" && chebyshevDistance(enemy.position, target.position) > 1) {
      return { ok: false, reason: "no_longer_possible" };
    }
    if (condition === "path_exists" && !nextGreedyPathCell(state.scene.cells, enemy, target)) {
      return { ok: false, reason: "path_blocked" };
    }
  }
  return { ok: true, target };
}

export function isIntentStillValid(state: RuntimeState, enemy: EntityRuntime, active: ActiveIntent, template: IntentTemplate): IntentValidation {
  const selectedTarget = active.targetEntityId ? state.entities.get(active.targetEntityId) : null;
  if (template.effect.handler === "hold_position") return { ok: true, target: null };
  if (!selectedTarget || !isEligibleTarget(state.scene.cells, enemy, selectedTarget, template)) {
    return { ok: false, reason: "target_invalid" };
  }
  if (template.targetRules.lineOfSight === "required" && !hasLineOfSight(state.scene.cells, enemy.position, selectedTarget.position)) {
    return { ok: false, reason: "los_blocked" };
  }
  for (const condition of template.conditions.preconditions) {
    if (condition === "melee_contact" && chebyshevDistance(enemy.position, selectedTarget.position) > 1) {
      return { ok: false, reason: "no_longer_possible" };
    }
    if (condition === "path_exists" && !nextGreedyPathCell(state.scene.cells, enemy, selectedTarget)) {
      return { ok: false, reason: "path_blocked" };
    }
  }
  return { ok: true, target: selectedTarget };
}
