import { createHash } from "node:crypto";
import { snapshotState } from "../engine/createRuntimeState.js";
import type { RuntimeState, RuntimeSnapshot, StatusLayer } from "../engine/types.js";

export function canonicalizeSnapshot(snapshot: RuntimeSnapshot): string {
  return JSON.stringify({
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
    scene: {
      id: snapshot.scene.id,
      width: snapshot.scene.width,
      height: snapshot.scene.height,
      cells: [...snapshot.scene.cells].sort((a, b) => a.y - b.y || a.x - b.x),
      playerEntityIds: [...snapshot.scene.playerEntityIds].sort(compareText),
      enemyEntityIds: [...snapshot.scene.enemyEntityIds].sort(compareText),
      startedAtTick: snapshot.scene.startedAtTick,
      contactImmunityUntilTick: [...snapshot.scene.contactImmunityUntilTick].sort(([a], [b]) => compareText(a, b)),
      inputWindow: {
        windowId: snapshot.scene.inputWindow.windowId,
        commands: [...snapshot.scene.inputWindow.commands]
          .sort((a, b) => a.serverReceiveSequence - b.serverReceiveSequence || compareText(a.actorId, b.actorId) || compareText(a.requestId, b.requestId))
          .map((command) => ({
            requestId: command.requestId,
            sessionId: command.sessionId,
            actorId: command.actorId,
            role: command.role,
            command: command.command,
            payload: command.payload,
            clientRevision: command.clientRevision,
            serverReceiveSequence: command.serverReceiveSequence,
          })),
      },
    },
    entities: [...snapshot.entities]
      .sort((a, b) => compareText(a.id, b.id))
      .map((entity) => entity.kind === "hero"
        ? {
            ...entity,
            statuses: canonicalStatuses(entity.statuses),
            stamina: {
              current: entity.stamina.current,
              max: entity.stamina.max,
              nextRegenAtTick: entity.stamina.nextRegenAtTick,
            },
            cards: {
              drawPile: entity.cards.drawPile.map((card) => ({ instanceId: card.instanceId, templateKey: card.templateKey })),
              hand: entity.cards.hand.map((card) => ({ instanceId: card.instanceId, templateKey: card.templateKey })),
              discard: entity.cards.discard.map((card) => ({ instanceId: card.instanceId, templateKey: card.templateKey })),
              excludedForMode: entity.cards.excludedForMode.map((card) => ({ instanceId: card.instanceId, templateKey: card.templateKey })),
              revision: entity.cards.revision,
              nextHandRotationAtTick: entity.cards.nextHandRotationAtTick,
            },
          }
        : { ...entity, statuses: canonicalStatuses(entity.statuses) }),
    activeIntents: [...snapshot.activeIntents].sort((a, b) => compareText(a.activeIntentId, b.activeIntentId)),
    heroIdByActorId: [...snapshot.heroIdByActorId].sort(([a], [b]) => compareText(a, b)),
    serverTick: snapshot.serverTick,
    sceneRevision: snapshot.sceneRevision,
    nextServerSequence: snapshot.nextServerSequence,
    rootSeed: snapshot.rootSeed,
    phase: snapshot.phase,
    paused: snapshot.paused,
    outcome: snapshot.outcome,
  });
}

function canonicalStatuses(statuses: readonly StatusLayer[]): StatusLayer[] {
  return [...statuses].sort((a, b) => compareText(a.id, b.id)).map((status) => ({
    id: status.id,
    templateKey: status.templateKey,
    sourceEntityId: status.sourceEntityId,
    potency: status.potency,
    stacks: status.stacks,
    appliedAtTick: status.appliedAtTick,
    expiresAtTick: status.expiresAtTick,
    refreshPolicy: status.refreshPolicy,
  }));
}

export function stateHashFromSnapshot(snapshot: RuntimeSnapshot): string {
  return createHash("sha256").update(canonicalizeSnapshot(snapshot), "utf8").digest("hex");
}

export function stateHash(state: RuntimeState): string {
  return stateHashFromSnapshot(snapshotState(state));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
