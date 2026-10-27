import { DeterministicRng } from "../rng/DeterministicRng.js";
import { eventBase, type PendingJournalEvent } from "../intents/events.js";
import {
  CARD_HAND_LIMIT,
  CARD_ROTATION_INTERVAL_TICKS,
  type CardInstance,
  type HeroMode,
  type HeroRuntime,
  type RngForkInput,
  type RuntimeState,
} from "../engine/types.js";

export type DeckEventCause = { requestId: string | null; actorId: string | null };
type CombatMode = Extract<HeroMode, "melee" | "ranged">;

/** Rebuilds and deals a mode-filtered deck immediately after a hero enters a combat mode. */
export function resolveModeEntryDeck(
  state: RuntimeState,
  hero: HeroRuntime,
  mode: CombatMode,
  fromMode: HeroMode | null,
  serverTick: number,
  cause: DeckEventCause,
): PendingJournalEvent[] {
  const cards = hero.cards;
  const source = [...cards.drawPile, ...cards.hand, ...cards.discard, ...cards.excludedForMode]
    .sort((a, b) => compareText(a.instanceId, b.instanceId));
  assertUniqueInstances(source, hero.id);

  const eligible = source.filter((card) => state.cardTemplates.get(card.templateKey)?.allowedModes.includes(mode) ?? false);
  const excluded = source.filter((card) => !state.cardTemplates.get(card.templateKey)?.allowedModes.includes(mode));
  const operationId = `deck:${hero.id}:${mode}:mode_entry:${cards.revision + 1}`;
  const forkInput: RngForkInput = {
    rootSeed: state.rootSeed,
    campaignId: state.campaignId,
    sceneId: state.scene.id,
    serverTick,
    activeIntentId: operationId,
    purpose: "deck_shuffle",
  };
  const shuffled = shuffleCardInstances(eligible, forkInput);

  cards.drawPile = shuffled.cards;
  cards.hand = [];
  cards.discard = [];
  cards.excludedForMode = excluded.map(cloneCard);
  cards.revision += 1;
  if (fromMode === null || fromMode === "movement" || cards.nextHandRotationAtTick === null) {
    cards.nextHandRotationAtTick = serverTick + CARD_ROTATION_INTERVAL_TICKS;
  }

  const pending: PendingJournalEvent[] = [{
    event: {
      ...eventBase(state, serverTick, cause.actorId, cause.requestId),
      eventType: "deck.shuffled",
      payload: {
        heroId: hero.id,
        mode,
        reason: "mode_entry",
        sourceCardInstanceIds: source.map((card) => card.instanceId),
        eligibleCardInstanceIds: eligible.map((card) => card.instanceId),
        excludedCardInstanceIds: excluded.map((card) => card.instanceId),
        orderedCardInstanceIds: shuffled.cards.map((card) => card.instanceId),
        operationId,
        cardRevision: cards.revision,
      },
      replay: { seedRef: shuffled.audit.seedRef },
    },
    rngAudit: [shuffled.audit],
  }];

  for (let index = 0; index < CARD_HAND_LIMIT && cards.drawPile.length > 0; index += 1) {
    const drawn = drawOne(state, hero, "mode_entry", serverTick, cause);
    if (!drawn) break;
    pending.push(drawn.pending);
  }
  return pending;
}

/** Clears an active hand timer on exit from combat; replay derives the same transition from mode.changed. */
export function stopHandRotation(hero: HeroRuntime): void {
  hero.cards.nextHandRotationAtTick = null;
}

/** Resolves at most one due hand-rotation transaction per active hero and tick. */
export function resolveDueHandRotations(state: RuntimeState, serverTick: number): PendingJournalEvent[] {
  const pending: PendingJournalEvent[] = [];
  const heroes = state.scene.playerEntityIds
    .map((id) => state.entities.get(id))
    .filter((entity): entity is HeroRuntime => entity?.kind === "hero")
    .sort((a, b) => compareText(a.id, b.id));

  for (const hero of heroes) {
    const dueAtTick = hero.cards.nextHandRotationAtTick;
    if (hero.aliveState !== "active" || (hero.mode !== "melee" && hero.mode !== "ranged") || dueAtTick === null || dueAtTick > serverTick) continue;
    if (dueAtTick !== serverTick) throw new Error(`Hero ${hero.id} missed hand rotation tick ${dueAtTick}`);

    const cause = { requestId: null, actorId: null };
    let discardedCardInstanceId: string | null = null;
    let drawnCardInstanceId: string | null = null;
    if (hero.cards.hand.length >= CARD_HAND_LIMIT) {
      const rightmost = hero.cards.hand.pop();
      if (!rightmost) throw new Error("Full hand lost its rightmost card during rotation");
      hero.cards.discard.push(cloneCard(rightmost));
      hero.cards.revision += 1;
      discardedCardInstanceId = rightmost.instanceId;
      pending.push({
        event: {
          ...eventBase(state, serverTick, null, null),
          eventType: "card.discarded",
          payload: {
            heroId: hero.id,
            cardInstanceId: rightmost.instanceId,
            reason: "timer_rotation",
            discardRevision: hero.cards.revision,
          },
          replay: null,
        },
      });
    }

    if (hero.cards.drawPile.length === 0 && hero.cards.discard.length > 0) {
      const shuffle = shuffleDiscard(state, hero, serverTick);
      pending.push(shuffle.pending);
    }
    if (hero.cards.drawPile.length > 0 && hero.cards.hand.length < CARD_HAND_LIMIT) {
      const drawn = drawOne(state, hero, "timer_rotation", serverTick, cause);
      if (drawn) {
        drawnCardInstanceId = drawn.cardInstanceId;
        pending.push(drawn.pending);
      }
    }

    hero.cards.nextHandRotationAtTick = dueAtTick + CARD_ROTATION_INTERVAL_TICKS;
    pending.push({
      event: {
        ...eventBase(state, serverTick, null, null),
        eventType: "deck.rotation_resolved",
        payload: {
          heroId: hero.id,
          dueAtTick,
          nextHandRotationAtTick: hero.cards.nextHandRotationAtTick,
          discardedCardInstanceId,
          drawnCardInstanceId,
          cardRevision: hero.cards.revision,
        },
        replay: null,
      },
    });
  }
  return pending;
}

export function shuffleCardInstances(
  source: readonly CardInstance[],
  forkInput: RngForkInput,
): { cards: CardInstance[]; audit: ReturnType<DeterministicRng["auditRecord"]> } {
  const rng = DeterministicRng.fork(forkInput);
  const before = rng.state();
  const cards = source.map(cloneCard);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [cards[index], cards[swapIndex]] = [cards[swapIndex]!, cards[index]!];
  }
  return { cards, audit: rng.auditRecord(forkInput, before) };
}

function shuffleDiscard(
  state: RuntimeState,
  hero: HeroRuntime,
  serverTick: number,
): { pending: PendingJournalEvent } {
  const source = [...hero.cards.discard].sort((a, b) => compareText(a.instanceId, b.instanceId));
  const operationId = `deck:${hero.id}:${hero.mode}:discard_exhausted:${hero.cards.revision + 1}`;
  const forkInput: RngForkInput = {
    rootSeed: state.rootSeed,
    campaignId: state.campaignId,
    sceneId: state.scene.id,
    serverTick,
    activeIntentId: operationId,
    purpose: "deck_shuffle",
  };
  const shuffled = shuffleCardInstances(source, forkInput);
  hero.cards.drawPile = shuffled.cards;
  hero.cards.discard = [];
  hero.cards.revision += 1;
  return {
    pending: {
      event: {
        ...eventBase(state, serverTick, null, null),
        eventType: "deck.shuffled",
        payload: {
          heroId: hero.id,
          mode: hero.mode === "ranged" ? "ranged" : "melee",
          reason: "discard_exhausted",
          sourceCardInstanceIds: source.map((card) => card.instanceId),
          eligibleCardInstanceIds: source.map((card) => card.instanceId),
          excludedCardInstanceIds: [],
          orderedCardInstanceIds: shuffled.cards.map((card) => card.instanceId),
          operationId,
          cardRevision: hero.cards.revision,
        },
        replay: { seedRef: shuffled.audit.seedRef },
      },
      rngAudit: [shuffled.audit],
    },
  };
}

function drawOne(
  state: RuntimeState,
  hero: HeroRuntime,
  reason: "mode_entry" | "timer_rotation",
  serverTick: number,
  cause: DeckEventCause,
): { pending: PendingJournalEvent; cardInstanceId: string } | null {
  const card = hero.cards.drawPile.shift();
  if (!card) return null;
  hero.cards.hand.unshift(cloneCard(card));
  hero.cards.revision += 1;
  return {
    cardInstanceId: card.instanceId,
    pending: {
      event: {
      ...eventBase(state, serverTick, cause.actorId, cause.requestId),
      eventType: "card.drawn",
      payload: {
        heroId: hero.id,
        cardInstanceId: card.instanceId,
        destination: "hand",
        reason,
        cardRevision: hero.cards.revision,
      },
      replay: null,
      },
    },
  };
}

function assertUniqueInstances(cards: readonly CardInstance[], heroId: string): void {
  const ids = new Set<string>();
  for (const card of cards) {
    if (!card.instanceId || ids.has(card.instanceId)) throw new Error(`Hero ${heroId} has duplicate card instance ${card.instanceId}`);
    ids.add(card.instanceId);
  }
}

function cloneCard(card: CardInstance): CardInstance {
  return { instanceId: card.instanceId, templateKey: card.templateKey };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
