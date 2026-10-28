import { applyDamage } from "../combat/damage.js";
import { canAffordStamina } from "../resources/stamina.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";
import {
  ALLY_GUARD_DEFENSE_BONUS_PERCENT,
  ALLY_GUARD_DURATION_TICKS,
  STAMINA_REGEN_INTERVAL_TICKS,
  type EngineErrorCode,
  type EntityRuntime,
  type InternalPlayCardCommand,
  type RuntimeState,
} from "../engine/types.js";
import { chebyshevDistance, hasLineOfSight } from "../intents/geometry.js";

export type PlayCardResolution =
  | { ok: true; pendingEvents: PendingJournalEvent[] }
  | { ok: false; code: EngineErrorCode };

/** Resolves a card from hand or the single defense slot. */
export function resolvePlayCard(state: RuntimeState, command: InternalPlayCardCommand): PlayCardResolution {
  const heroId = state.heroIdByActorId.get(command.actorId);
  const hero = heroId ? state.entities.get(heroId) : undefined;
  if (!hero || hero.kind !== "hero" || hero.aliveState !== "active" || hero.hp.current <= 0) return { ok: false, code: "ENTITY_UNABLE_TO_ACT" };
  if (command.clientRevision !== state.sceneRevision) return { ok: false, code: "STALE_SCENE_REVISION" };
  if (command.payload.clientCardRevision !== hero.cards.revision) return { ok: false, code: "STALE_CARD_REVISION" };

  const handIndex = hero.cards.hand.findIndex((card) => card.instanceId === command.payload.cardInstanceId);
  const inDefenseSlot = hero.cards.defenseSlot?.instanceId === command.payload.cardInstanceId;
  const card = inDefenseSlot ? hero.cards.defenseSlot : hero.cards.hand[handIndex];
  const template = card ? state.cardTemplates.get(card.templateKey) : undefined;
  if (!card || !template) return { ok: false, code: "CARD_NOT_AVAILABLE" };
  const isDefenseEffect = template.effect.kind !== "direct_damage";
  if ((inDefenseSlot && !isDefenseEffect) || (!inDefenseSlot && isDefenseEffect)) return { ok: false, code: "CARD_NOT_AVAILABLE" };
  if (hero.mode !== command.payload.mode || !template.allowedModes.includes(command.payload.mode)) return { ok: false, code: "CARD_MODE_MISMATCH" };

  let target: EntityRuntime | undefined;
  if (template.effect.kind === "direct_damage") {
    if (!command.payload.targetEntityId) return { ok: false, code: "TARGET_NOT_VISIBLE" };
    target = state.entities.get(command.payload.targetEntityId);
    if (!target || target.kind !== "enemy" || target.aliveState !== "active" || target.hp.current <= 0) return { ok: false, code: "TARGET_NOT_VISIBLE" };
  } else {
    target = command.payload.targetEntityId ? state.entities.get(command.payload.targetEntityId) : hero;
    if (!target || target.kind !== "hero" || target.aliveState !== "active" || target.hp.current <= 0) return { ok: false, code: "TARGET_NOT_VISIBLE" };
  }
  if (command.payload.targetCell && !sameCell(command.payload.targetCell, target.position)) return { ok: false, code: "TARGET_NOT_VISIBLE" };
  const distance = chebyshevDistance(hero.position, target.position);
  if (distance < template.range.minInclusive || distance > template.range.maxInclusive) return { ok: false, code: "TARGET_OUT_OF_RANGE" };
  if (template.lineOfSight === "required" && !hasLineOfSight(state.scene.cells, hero.position, target.position)) return { ok: false, code: "LINE_OF_SIGHT_BLOCKED" };
  if (!canAffordStamina(hero.stamina.current, template.staminaCost)) return { ok: false, code: "INSUFFICIENT_STAMINA" };

  const cause = { requestId: command.requestId, actorId: command.actorId };
  const pendingEvents: PendingJournalEvent[] = [{
    event: {
      ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
      eventType: "card.played",
      payload: { heroId: hero.id, cardInstanceId: card.instanceId, mode: command.payload.mode,
        staminaCost: template.staminaCost, targetEntityId: target.id, targetCell: { ...target.position } },
      replay: null,
    },
  }];

  if (template.staminaCost > 0) {
    hero.stamina.current -= template.staminaCost;
    hero.stamina.nextRegenAtTick = hero.stamina.current < hero.stamina.max ? state.serverTick + STAMINA_REGEN_INTERVAL_TICKS : null;
    pendingEvents.push({ event: { ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
      eventType: "stamina.changed", payload: { heroId: hero.id, current: hero.stamina.current, maximum: hero.stamina.max, reason: "card_cost" }, replay: null } });
  }

  if (template.effect.kind === "direct_damage") {
    const damage = applyDamage(state, { target, source: { kind: "card", heroId: hero.id, cardInstanceId: card.instanceId, cardTemplateKey: template.key },
      rawDamage: template.effect.rawDamage, multiplier: template.effect.multiplier, serverTick: state.serverTick,
      causedByRequestId: command.requestId, actorId: command.actorId });
    pendingEvents.push(...damage.protectionEvents);
    if (damage.event) pendingEvents.push(damage.event);
  } else {
    if (target.kind !== "hero") return { ok: false, code: "TARGET_NOT_VISIBLE" };
    const effectEvent: PendingJournalEvent = { event: { ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
      eventType: "card.effect_applied", payload: { heroId: hero.id, cardInstanceId: card.instanceId, targetEntityId: target.id, effect: { ...template.effect } }, replay: null } };
    if (effectEvent.event.eventType !== "card.effect_applied") throw new Error("Invalid card effect event");
    if (template.effect.kind === "prevent_one_attack" || template.effect.kind === "damage_barrier") {
      const protectionId = `protection:${hero.id}:${card.instanceId}:${state.serverTick}`;
      const amount = template.effect.kind === "damage_barrier" ? template.effect.amount : 0;
      target.protections.push(template.effect.kind === "damage_barrier"
        ? { id: protectionId, kind: "damage_barrier", sourceCardInstanceId: card.instanceId, remainingAmount: amount }
        : { id: protectionId, kind: "prevent_one_attack", sourceCardInstanceId: card.instanceId });
      effectEvent.event.payload.protectionId = protectionId;
      effectEvent.event.payload.amount = amount;
      pendingEvents.push(effectEvent, { event: { ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
        eventType: "protection.applied", payload: { heroId: target.id, protectionId, kind: template.effect.kind, sourceCardInstanceId: card.instanceId, amount }, replay: null } });
    } else {
      const existing = target.statuses.find((layer) => layer.templateKey === "ally_guard" && layer.expiresAtTick >= state.serverTick);
      const expiresAtTick = state.serverTick + ALLY_GUARD_DURATION_TICKS;
      const layerId = existing?.id ?? `status:${target.id}:ally_guard:${card.instanceId}`;
      if (existing) { existing.appliedAtTick = state.serverTick; existing.expiresAtTick = expiresAtTick; }
      else target.statuses.push({ id: layerId, templateKey: "ally_guard", sourceEntityId: hero.id,
        potency: ALLY_GUARD_DEFENSE_BONUS_PERCENT, stacks: 1, appliedAtTick: state.serverTick,
        expiresAtTick, refreshPolicy: "refresh_duration" });
      effectEvent.event.payload.statusLayer = { layerId, potency: ALLY_GUARD_DEFENSE_BONUS_PERCENT, expiresAtTick };
      pendingEvents.push(effectEvent);
    }
  }

  if (inDefenseSlot) hero.cards.defenseSlot = null;
  else hero.cards.hand.splice(handIndex, 1);
  hero.cards.discard.push({ ...card });
  hero.cards.revision += 1;
  pendingEvents.push({ event: { ...eventBase(state, state.serverTick, cause.actorId, cause.requestId),
    eventType: "card.discarded", payload: { heroId: hero.id, cardInstanceId: card.instanceId, reason: "played", discardRevision: hero.cards.revision }, replay: null } });
  return { ok: true, pendingEvents };
}

function sameCell(a: { x: number; y: number }, b: { x: number; y: number }): boolean { return a.x === b.x && a.y === b.y; }
