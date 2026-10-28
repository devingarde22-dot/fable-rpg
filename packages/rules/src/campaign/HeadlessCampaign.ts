import type { CampaignOutcome, DomainEvent, RuntimeSnapshot } from "../engine/types.js";
import type { SimulationEngine } from "../engine/SimulationEngine.js";

export type CampaignLocation = "city" | "route" | "node" | "scene";
export type CampaignNodeState = "open" | "closed" | "completed";
export type CampaignOutcomeResult = {
  outcome: CampaignOutcome;
  rewardUnlocked: boolean;
  nodeState: CampaignNodeState;
  retryAllowed: boolean;
  outcomeEvent: DomainEvent;
  rollbackEvent: DomainEvent;
  cityCheckpointId: string;
  snapshot: RuntimeSnapshot;
};

/** Minimal in-memory campaign loop for the headless reference slice; it grants no reward items. */
export class HeadlessCampaign {
  readonly engine: SimulationEngine;
  location: CampaignLocation = "city";
  cityId: string;
  routeId: string | null = null;
  nodeId: string | null = null;
  nodeState: CampaignNodeState = "open";
  rewardUnlocked = false;
  private cityCheckpointId!: string;
  private readonly completedNodeIds = new Set<string>();

  constructor(engine: SimulationEngine, initialCityId: string) {
    if (!initialCityId.trim()) throw new Error("Initial city id must not be empty");
    this.engine = engine;
    this.cityId = initialCityId;
    this.cityCheckpointId = this.visitCity(initialCityId);
  }

  /** Every city visit creates a fresh in-memory save point. */
  visitCity(cityId: string): string {
    if (!cityId.trim()) throw new Error("City id must not be empty");
    this.cityId = cityId;
    this.location = "city";
    this.routeId = null;
    this.nodeId = null;
    const checkpoint = this.engine.createCheckpoint(`city-save:${cityId}`);
    this.cityCheckpointId = checkpoint.checkpointId;
    return checkpoint.checkpointId;
  }

  enterRoute(routeId: string): void {
    if (this.location !== "city" || !routeId.trim()) throw new Error("A route can only be entered from a city");
    this.routeId = routeId;
    this.location = "route";
  }

  enterNode(nodeId: string): void {
    if (this.location !== "route" || !nodeId.trim()) throw new Error("A node can only be entered from a route");
    if (this.completedNodeIds.has(nodeId)) throw new Error(`Node ${nodeId} is already completed`);
    this.nodeId = nodeId;
    this.nodeState = "open";
    this.rewardUnlocked = false;
    this.location = "node";
  }

  startScene(): void {
    if (this.location !== "node") throw new Error("A scene can only start from an open node");
    this.location = "scene";
  }

  /** GM confirmation is explicit; SimulationEngine checks outcome eligibility. */
  confirmOutcome(outcome: CampaignOutcome, reason?: string): CampaignOutcomeResult {
    if (this.location !== "scene" || !this.nodeId) throw new Error("There is no active node scene to close");
    const confirmed = this.engine.confirmOutcome(outcome, reason);
    this.rewardUnlocked = confirmed.rewardUnlocked;
    if (outcome === "success" && this.nodeId) this.completedNodeIds.add(this.nodeId);
    this.nodeState = outcome === "success" ? "completed" : outcome === "retreat" ? "open" : "closed";
    const rollback = this.engine.rollback(this.cityCheckpointId);
    // Return to the last city save; the checkpoint event is appended after the rollback event.
    const nextCityCheckpointId = this.visitCity(this.cityId);
    return {
      outcome,
      rewardUnlocked: this.rewardUnlocked,
      nodeState: this.nodeState,
      retryAllowed: outcome !== "success",
      outcomeEvent: confirmed.event,
      rollbackEvent: rollback.event,
      cityCheckpointId: nextCityCheckpointId,
      snapshot: this.engine.snapshot(),
    };
  }
}
