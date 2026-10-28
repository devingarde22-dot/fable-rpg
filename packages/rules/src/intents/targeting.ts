import { cellIndex } from "../grid/Grid.js";
import { DeterministicRng } from "../rng/DeterministicRng.js";
import type { ActiveIntent, CellRuntime, EntityRuntime, IntentTemplate, RuntimeState, TargetPolicy } from "../engine/types.js";
import { chebyshevDistance, hasLineOfSight } from "./geometry.js";
import { hasActiveStatus } from "../statuses/statusSystem.js";

export type SelectedTarget = {
  target: EntityRuntime;
  policy: Exclude<TargetPolicy, "none">;
  targetCell: { x: number; y: number };
  tieBreak: "seeded_random" | "single_candidate";
};

export function selectIntentTarget(
  state: RuntimeState,
  enemy: EntityRuntime,
  template: IntentTemplate,
  activeIntentId: string,
  currentTargetId: string | null = null,
  rng: DeterministicRng = DeterministicRng.fork({
    rootSeed: state.rootSeed,
    campaignId: state.campaignId,
    sceneId: state.scene.id,
    serverTick: state.serverTick,
    activeIntentId,
    purpose: "target_selection",
  }),
): SelectedTarget | null {
  const policies = [template.targetRules.policy, ...template.targetRules.fallbackPolicies];
  for (const policy of policies) {
    if (policy === "none") continue;
    const candidates = rankedCandidatesForPolicy(state, enemy, template, policy, currentTargetId);
    if (candidates.length === 0) continue;
    const bestScore = Math.min(...candidates.map((candidate) => scoreForPolicy(policy, enemy, candidate)));
    const tied = candidates.filter((candidate) => scoreForPolicy(policy, enemy, candidate) === bestScore);
    const tieBreak = tied.length > 1 ? "seeded_random" : "single_candidate";
    const target = tied.length > 1 ? tied[rng.nextInt(tied.length)]! : tied[0]!;
    return { target, policy, targetCell: { ...target.position }, tieBreak };
  }
  return null;
}

export function isEligibleTarget(
  cells: readonly CellRuntime[],
  enemy: EntityRuntime,
  candidate: EntityRuntime,
  template: IntentTemplate,
  serverTick = 0,
): boolean {
  const filters = template.targetRules.filters;
  if (!filters.factions.includes(candidate.faction) || !filters.aliveStates.includes(candidate.aliveState) || candidate.hp.current === 0) return false;
  if (filters.requiredStatuses.some((status) => !hasActiveStatus(candidate, status, serverTick))) return false;
  if (filters.excludedStatuses.some((status) => hasActiveStatus(candidate, status, serverTick))) return false;
  if (candidate.id === enemy.id) return false;
  const distance = chebyshevDistance(enemy.position, candidate.position);
  const range = template.targetRules.range;
  if (range && (distance < range.minInclusive || distance > range.maxInclusive)) return false;
  if (template.targetRules.lineOfSight === "required" && !hasLineOfSight(cells, enemy.position, candidate.position)) return false;
  return true;
}

function rankedCandidatesForPolicy(
  state: RuntimeState,
  enemy: EntityRuntime,
  template: IntentTemplate,
  policy: Exclude<TargetPolicy, "none">,
  currentTargetId: string | null,
): EntityRuntime[] {
  const cells = state.scene.cells;
  const candidates = [...state.entities.values()].filter((candidate) =>
    isEligibleTarget(cells, enemy, candidate, template, state.serverTick) &&
    (policy !== "nearest_visible_player" || hasLineOfSight(cells, enemy.position, candidate.position)));
  if (policy === "current_target") return candidates.filter((candidate) => candidate.id === currentTargetId);
  return candidates.sort((a, b) => compareEntityId(a.id, b.id));
}

function scoreForPolicy(policy: Exclude<TargetPolicy, "none">, enemy: EntityRuntime, target: EntityRuntime): number {
  switch (policy) {
    case "current_target":
      return 0;
    case "nearest_player":
    case "nearest_visible_player":
      return chebyshevDistance(enemy.position, target.position);
    case "highest_threat":
      return -target.threat;
    case "lowest_ally_hp_percentage":
      return healthRatio(target);
  }
}

function healthRatio(entity: EntityRuntime): number {
  return entity.hp.max === 0 ? Number.POSITIVE_INFINITY : entity.hp.current / entity.hp.max;
}

export function compareEntityId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function targetCellIndex(target: EntityRuntime): number {
  return cellIndex(target.position);
}

export function activeIntentTarget(state: RuntimeState, intent: ActiveIntent | undefined): EntityRuntime | null {
  if (!intent?.targetEntityId) return null;
  const target = state.entities.get(intent.targetEntityId);
  return target && target.aliveState === "active" && target.hp.current > 0 ? target : null;
}
