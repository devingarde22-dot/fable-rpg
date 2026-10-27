import { applyDamage } from "../combat/damage.js";
import { canAffordStamina } from "../resources/stamina.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";
import { chebyshevDistance, hasLineOfSight } from "../intents/geometry.js";
import { STAMINA_REGEN_INTERVAL_TICKS, type EngineErrorCode, type InternalPlayCardCommand, type RuntimeState } from "../engine/types.js";

export type PlayCardResolution =
  | { ok: true; pendingEvents: PendingJournalEvent[] }
  | { ok: false; code: EngineErrorCode };

/** Resolves only single-target direct-damage cards already present in the hero's hand. */
export function resolvePlayCard(state: RuntimeState, command: InternalPlayCardCommand): PlayCardResolution {
  const heroId = state.heroIdByActorId.get(command.actorId);
  const hero = heroId ? state.entities.get(heroId) : undefined;
  if (!hero || hero.kind !== "hero" || hero.aliveState !== "active" || hero.hp.current <= 0) {
    return { ok: false, code: "ENTITY_UNABLE_TO_ACT" };
  }
  if (command.clientRevision !== state.sceneRevision) return { ok: false, code: "STALE_SCENE_REVISION" };
  if (command.payload.clientCardRevision !== hero.cards.revision) return { ok: false, code: "STALE_CARD_REVISION" };

  const cardIndex = hero.cards.hand.findIndex((card) => card.instanceId === command.payload.cardInstanceId);
  if (cardIndex < 0) return { ok: false, code: "CARD_NOT_AVAILABLE" };
  const card = hero.cards.hand[cardIndex];
  if (!card) return { ok: false, code: "CARD_NOT_AVAILABLE" };
  const template = state.cardTemplates.get(card.templateKey);
  if (!template) return { ok: false, code: "CARD_NOT_AVAILABLE" };

  if (hero.mode !== command.payload.mode || !template.allowedModes.includes(command.payload.mode)) {
    return { ok: false, code: "CARD_MODE_MISMATCH" };
  }
  if (!command.payload.targetEntityId) return { ok: false, code: "TARGET_NOT_VISIBLE" };
  const target = state.entities.get(command.payload.targetEntityId);
  if (!target || target.kind !== "enemy" || target.aliveState !== "active" || target.hp.current <= 0 ||
    (command.payload.targetCell !== undefined && !sameCell(command.payload.targetCell, target.position))) {
    return { ok: false, code: "TARGET_NOT_VISIBLE" };
  }

  const distance = chebyshevDistance(hero.position, target.position);
  if (distance < template.range.minInclusive || distance > template.range.maxInclusive) {
    return { ok: false, code: "TARGET_OUT_OF_RANGE" };
  }
  if (template.lineOfSight === "required" && !hasLineOfSight(state.scene.cells, hero.position, target.position)) {
    return { ok: false, code: "LINE_OF_SIGHT_BLOCKED" };
  }
  if (!canAffordStamina(hero.stamina.current, template.staminaCost)) {
    return { ok: false, code: "INSUFFICIENT_STAMINA" };
  }

  const cause = { requestId: command.requestId, actorId: command.actorId };
  const pendingEvents: PendingJournalEvent[] = [{
    event: {
      ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
      eventType: "card.played",
      payload: {
        heroId: hero.id,
        cardInstanceId: card.instanceId,
        mode: command.payload.mode,
        staminaCost: template.staminaCost,
        targetEntityId: target.id,
        targetCell: { ...target.position },
      },
      replay: null,
    },
  }];

  // Apply damage while the source card is still in hand; every remaining commit step is non-failing.
  const damage = applyDamage(state, {
    target,
    source: {
      kind: "card",
      heroId: hero.id,
      cardInstanceId: card.instanceId,
      cardTemplateKey: template.key,
    },
    rawDamage: template.effect.rawDamage,
    multiplier: template.effect.multiplier,
    serverTick: state.serverTick,
    causedByRequestId: command.requestId,
    actorId: command.actorId,
  });
  if (!damage.event) throw new Error("A valid direct-damage card must produce an hp.changed event");

  if (template.staminaCost > 0) {
    hero.stamina.current -= template.staminaCost;
    hero.stamina.nextRegenAtTick = hero.stamina.current < hero.stamina.max
      ? state.serverTick + STAMINA_REGEN_INTERVAL_TICKS
      : null;
    pendingEvents.push({
      event: {
        ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
        eventType: "stamina.changed",
        payload: {
          heroId: hero.id,
          current: hero.stamina.current,
          maximum: hero.stamina.max,
          reason: "card_cost",
        },
        replay: null,
      },
    });
  }

  pendingEvents.push(damage.event);
  const movedCard = hero.cards.hand.splice(cardIndex, 1)[0];
  if (!movedCard) throw new Error("Card disappeared from hand during a validated play");
  hero.cards.discard.push({ ...movedCard });
  hero.cards.revision += 1;
  pendingEvents.push({
    event: {
      ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
      eventType: "card.discarded",
      payload: {
        heroId: hero.id,
        cardInstanceId: movedCard.instanceId,
        reason: "played",
        discardRevision: hero.cards.revision,
      },
      replay: null,
    },
  });
  return { ok: true, pendingEvents };
}

function sameCell(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}
