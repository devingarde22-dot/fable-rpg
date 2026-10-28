import { TickClock } from "../clock/TickClock.js";
import { EventJournal } from "../journal/EventJournal.js";
import { stateHash } from "../replay/stateHash.js";
import { replayEvents, replayJournalRecords } from "../replay/replay.js";
import { closedWindowIdAtTick, windowIdAtTick } from "../scheduler/InputWindow.js";
import { orderCommands, phaseOrder, type SchedulerPhase } from "../scheduler/orderCommands.js";
import { validateMove } from "../movement/playerMove.js";
import { cellIndex, isInBounds } from "../grid/Grid.js";
import { activateScene, resolveDueIntents } from "../intents/intentSystem.js";
import { eventBase, groupEvents, type PendingJournalEvent } from "../intents/events.js";
import { detectContactTransitions, modeChangedEvent } from "../combat/heroModes.js";
import { resolveRetreat } from "../combat/retreatResolution.js";
import { resolveStaminaRegeneration } from "../resources/stamina.js";
import { resolvePlayCard } from "../cards/playCard.js";
import { resolveDueHandRotations, resolveModeEntryDeck, stopHandRotation } from "../cards/deckLifecycle.js";
import { hasActiveStatus, resolveDueStatusExpirations } from "../statuses/statusSystem.js";
import { cleanupDeadEnemies } from "./cleanup.js";
import { assertRuntimeInvariants } from "./invariants.js";
import { cloneRuntimeState, createRuntimeState, createRuntimeStateFromSnapshot, snapshotState } from "./createRuntimeState.js";
import type {
  DomainEvent,
  EngineErrorCode,
  FinalCommandResult,
  CachedCommandResult,
  InternalCommand,
  InternalModeCommand,
  InternalPlayCardCommand,
  InternalPlayerMoveCommand,
  JournalRecord,
  RuntimeSnapshot,
  RuntimeState,
  SimulationEngineRestoreConfig,
  SimulationEngineConfig,
  SubmitResult,
  TickResult,
  CampaignOutcome,
} from "./types.js";

export interface SimulationEngine {
  readonly state: Readonly<RuntimeState>;
  submit(command: InternalCommand): SubmitResult;
  advanceOneTick(): TickResult;
  advanceTicks(count: number): TickResult[];
  snapshot(): RuntimeSnapshot;
  setPaused(paused: boolean): void;
  events(): readonly DomainEvent[];
  journalRecords(): readonly JournalRecord[];
  replay(events: readonly DomainEvent[]): RuntimeSnapshot;
  replayJournal(): RuntimeSnapshot;
  createCheckpoint(label: string): { checkpointId: string; snapshot: RuntimeSnapshot; event: DomainEvent };
  rollback(checkpointId: string): { snapshot: RuntimeSnapshot; event: DomainEvent };
  confirmOutcome(outcome: CampaignOutcome, reason?: string): { snapshot: RuntimeSnapshot; event: DomainEvent; rewardUnlocked: boolean };
}

export type SimulationEngineOptions = {
  onPhase?: (phase: SchedulerPhase, tick: number) => void;
};

type AppliedCommand = {
  result: FinalCommandResult;
  pendingEvents: PendingJournalEvent[];
  destinationCell?: number;
};

export class HeadlessSimulationEngine implements SimulationEngine {
  private runtime: RuntimeState;
  private readonly initialState: RuntimeState;
  private clock: TickClock;
  private readonly journal = new EventJournal();
  private readonly requestResults = new Map<string, CachedCommandResult>();
  private readonly checkpoints = new Map<string, RuntimeState>();
  private readonly options: SimulationEngineOptions;

  constructor(config: SimulationEngineConfig, options?: SimulationEngineOptions);
  constructor(runtime: RuntimeState, options: SimulationEngineOptions, restored: true);
  constructor(input: SimulationEngineConfig | RuntimeState, options: SimulationEngineOptions = {}, restored = false) {
    this.runtime = restored ? input as RuntimeState : createRuntimeState(input as SimulationEngineConfig);
    this.initialState = cloneRuntimeState(this.runtime);
    this.clock = new TickClock(this.runtime.serverTick);
    this.options = options;

    if (!restored) {
      const initialPending = activateScene(this.runtime);
      initialPending.push(...withDeckModeTransitions(this.runtime, detectContactTransitions(this.runtime, this.runtime.serverTick)));
      const initialBatch = groupEvents(this.runtime, initialPending);
      this.journal.appendBatch(initialBatch.events, initialBatch.auditByEventId);
      this.journal.appendTick(this.runtime.serverTick, this.runtime.sceneRevision, this.runtime.scene.inputWindow);
    }
    assertRuntimeInvariants(this.runtime);
  }

  /** Restore an engine without replaying scene-start effects or resetting the persisted clock/revisions. */
  static fromSnapshot(snapshot: RuntimeSnapshot, config: SimulationEngineRestoreConfig, options: SimulationEngineOptions = {}): HeadlessSimulationEngine {
    return new HeadlessSimulationEngine(createRuntimeStateFromSnapshot(snapshot, config), options, true);
  }

  get state(): Readonly<RuntimeState> {
    return cloneRuntimeState(this.runtime);
  }

  submit(command: InternalCommand): SubmitResult {
    const requestId = extractRequestId(command);
    if (!this.isValidCommand(command)) return {
      status: "rejected", requestId, code: "SCHEMA_INVALID", sceneRevision: this.runtime.sceneRevision,
    };
    const key = requestKey(command);
    const previous = this.requestResults.get(key);
    if (previous) return { status: "duplicate", requestId, original: structuredClone(previous) };

    const rejected = (code: EngineErrorCode): SubmitResult => {
      const result: SubmitResult = { status: "rejected", requestId, code, sceneRevision: this.runtime.sceneRevision };
      this.requestResults.set(key, structuredClone(result));
      return result;
    };

    if (this.runtime.phase === "ended") return rejected("STATE_LOCKED");
    if (this.runtime.paused) return rejected("SCENE_PAUSED");
    if (this.runtime.phase !== "active" || command.role !== "player" || command.sessionId !== this.runtime.sessionId) return rejected("AUTH_FORBIDDEN");
    const heroId = this.runtime.heroIdByActorId.get(command.actorId);
    const hero = heroId ? this.runtime.entities.get(heroId) : undefined;
    if (!hero || hero.kind !== "hero" || hero.aliveState !== "active") return rejected("AUTH_FORBIDDEN");
    // Player commands do not use the global scene revision as an admission gate.
    // Their action-specific preconditions are revalidated against live state on apply;
    // cards additionally bind to the hand/deck revision in resolvePlayCard.

    const windowId = windowIdAtTick(this.runtime.serverTick);
    if (this.runtime.scene.inputWindow.windowId !== windowId) {
      this.runtime.scene.inputWindow = { windowId, commands: [] };
    }
    this.runtime.scene.inputWindow.commands.push(cloneCommand(command));
    this.journal.appendInputWindow(this.runtime.serverTick, this.runtime.scene.inputWindow);
    const result: SubmitResult = { status: "queued", requestId: command.requestId, windowId };
    this.requestResults.set(key, structuredClone(result));
    return result;
  }

  advanceOneTick(): TickResult {
    if (this.runtime.phase === "ended") return {
      serverTick: this.runtime.serverTick, closedWindowId: null, events: [], commandResults: [],
      sceneRevision: this.runtime.sceneRevision, stateHash: stateHash(this.runtime),
    };
    if (this.runtime.paused) return {
      serverTick: this.runtime.serverTick, closedWindowId: null, events: [], commandResults: [],
      sceneRevision: this.runtime.sceneRevision, stateHash: stateHash(this.runtime),
    };
    const commandsInOpenWindow = this.runtime.scene.inputWindow.commands;
    this.runtime.serverTick = this.clock.advance();
    const closedWindowId = closedWindowIdAtTick(this.runtime.serverTick);
    const pending: PendingJournalEvent[] = [];
    const commandResults: FinalCommandResult[] = [];
    const commandEventIndexes: number[][] = [];
    const orderedCommands = closedWindowId === null ? [] : orderCommands(commandsInOpenWindow);
    const reservations = new Set<number>();

    if (closedWindowId !== null) {
      this.runtime.scene.inputWindow = { windowId: windowIdAtTick(this.runtime.serverTick), commands: [] };
    }

    for (const phase of phaseOrder()) {
      this.options.onPhase?.(phase, this.runtime.serverTick);
      if (phase === "players" && closedWindowId !== null) {
        for (const command of orderedCommands) {
          const applied = command.command === "player.move"
            ? this.applyMove(command, reservations)
            : command.command === "player.play_card"
              ? this.applyPlayCard(command)
              : this.applyModeCommand(command);
          commandResults.push(applied.result);
          const pendingStart = pending.length;
          pending.push(...applied.pendingEvents);
          commandEventIndexes.push(applied.pendingEvents.map((_, eventIndex) => pendingStart + eventIndex));
          if (applied.destinationCell !== undefined) reservations.add(applied.destinationCell);
        }
      } else if (phase === "enemies") {
        const enemyEvents = resolveDueIntents(this.runtime, this.runtime.serverTick);
        pending.push(...enemyEvents);
        if (enemyEvents.some(({ event }) => event.eventType === "scene.entity_moved")) {
          pending.push(...withDeckModeTransitions(this.runtime, detectContactTransitions(this.runtime, this.runtime.serverTick)));
        }
      } else if (phase === "resources") {
        pending.push(...resolveStaminaRegeneration(this.runtime, this.runtime.serverTick));
      } else if (phase === "cards") {
        pending.push(...resolveDueHandRotations(this.runtime, this.runtime.serverTick));
      } else if (phase === "statuses") {
        pending.push(...resolveDueStatusExpirations(this.runtime, this.runtime.serverTick));
      }
      // Environment has no active effects in this increment; its phase remains explicit and ordered.
    }

    pending.push(...cleanupDeadEnemies(this.runtime, this.runtime.serverTick));

    const committed = groupEvents(this.runtime, pending);
    this.journal.appendBatch(committed.events, committed.auditByEventId);
    this.journal.appendTick(this.runtime.serverTick, this.runtime.sceneRevision, this.runtime.scene.inputWindow);

    for (let index = 0; index < commandResults.length; index += 1) {
      const result = commandResults[index];
      const command = orderedCommands[index];
      if (!result || !command) continue;
      if (result.status === "accepted") {
        // Keep the command's exact event slice: derived effects may name their source entity as actorId,
        // and separate actors are allowed to use the same requestId.
        const requestEvents = (commandEventIndexes[index] ?? [])
          .map((eventIndex) => committed.events[eventIndex])
          .filter((event): event is DomainEvent => event !== undefined);
        if (requestEvents.length > 0) {
          result.eventIds = requestEvents.map((event) => event.eventId);
          result.sceneRevision = requestEvents[0]?.sceneRevision ?? this.runtime.sceneRevision;
        }
      }
      this.requestResults.set(requestKey(command), structuredClone(result));
    }

    assertRuntimeInvariants(this.runtime);
    return {
      serverTick: this.runtime.serverTick,
      closedWindowId,
      events: committed.events.map((event) => structuredClone(event)),
      commandResults,
      sceneRevision: this.runtime.sceneRevision,
      stateHash: stateHash(this.runtime),
    };
  }

  advanceTicks(count: number): TickResult[] {
    if (!Number.isInteger(count) || count < 0) throw new RangeError("count must be a non-negative integer");
    const results: TickResult[] = [];
    for (let index = 0; index < count; index += 1) results.push(this.advanceOneTick());
    return results;
  }

  snapshot(): RuntimeSnapshot {
    return snapshotState(this.runtime);
  }

  setPaused(paused: boolean): void {
    if (this.runtime.phase !== "active") throw new Error("Pause can only change in an active scene");
    if (this.runtime.paused === paused) return;
    this.runtime.paused = paused;
    this.journal.appendPause(paused, this.runtime.serverTick, this.runtime.sceneRevision);
    assertRuntimeInvariants(this.runtime);
  }

  events(): readonly DomainEvent[] {
    return this.journal.events();
  }

  journalRecords(): readonly JournalRecord[] {
    return this.journal.records();
  }

  replay(events: readonly DomainEvent[]): RuntimeSnapshot {
    return replayEvents(this.initialState, events);
  }

  replayJournal(): RuntimeSnapshot {
    return replayJournalRecords(this.initialState, this.journal.records());
  }

  createCheckpoint(label: string): { checkpointId: string; snapshot: RuntimeSnapshot; event: DomainEvent } {
    if (!label.trim()) throw new Error("Checkpoint label must not be empty");
    if (this.runtime.phase !== "active") throw new Error("Checkpoint can only be created in an active scene");
    const checkpointId = `checkpoint:${this.runtime.campaignId}:${this.runtime.scene.id}:${this.runtime.nextServerSequence}`;
    const pending: PendingJournalEvent = { event: { ...eventBase(this.runtime, this.runtime.serverTick, null, null),
      eventType: "checkpoint.created", payload: { checkpointId, label, snapshotSchemaVersion: 1 }, replay: null } };
    const committed = groupEvents(this.runtime, [pending]);
    const event = committed.events[0];
    if (!event) throw new Error("Checkpoint event was not committed");
    this.journal.appendBatch(committed.events, committed.auditByEventId);
    this.checkpoints.set(checkpointId, cloneRuntimeState(this.runtime));
    assertRuntimeInvariants(this.runtime);
    return { checkpointId, snapshot: this.snapshot(), event: structuredClone(event) };
  }

  rollback(checkpointId: string): { snapshot: RuntimeSnapshot; event: DomainEvent } {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId}`);
    const previousRevision = this.runtime.sceneRevision;
    const currentTick = this.runtime.serverTick;
    const nextSequence = this.runtime.nextServerSequence;
    const restored = cloneRuntimeState(checkpoint);
    if (currentTick < restored.serverTick) throw new Error("Rollback cannot move the server clock backwards");
    rebaseTimers(restored, currentTick - restored.serverTick);
    restored.serverTick = currentTick;
    restored.sceneRevision = previousRevision;
    restored.nextServerSequence = nextSequence;
    restored.scene.inputWindow = { windowId: Math.floor(currentTick / 5), commands: [] };
    this.runtime = restored;
    this.clock = new TickClock(currentTick);
    const pending: PendingJournalEvent = { event: { ...eventBase(this.runtime, currentTick, null, null),
      eventType: "rollback.applied", payload: { checkpointId, previousRevision, targetRevision: checkpoint.sceneRevision,
        restoredRevision: previousRevision + 1 }, replay: null } };
    const committed = groupEvents(this.runtime, [pending]);
    const event = committed.events[0];
    if (!event) throw new Error("Rollback event was not committed");
    this.journal.appendBatch(committed.events, committed.auditByEventId);
    assertRuntimeInvariants(this.runtime);
    return { snapshot: this.snapshot(), event: structuredClone(event) };
  }

  confirmOutcome(outcome: CampaignOutcome, reason?: string): { snapshot: RuntimeSnapshot; event: DomainEvent; rewardUnlocked: boolean } {
    if (this.runtime.phase !== "active" || this.runtime.outcome !== null) throw new Error("Outcome can only be confirmed once in an active scene");
    const heroes = [...this.runtime.entities.values()].filter((entity) => entity.kind === "hero");
    const enemies = this.runtime.scene.enemyEntityIds.map((id) => this.runtime.entities.get(id)).filter((entity) => entity?.kind === "enemy");
    if (outcome === "success" && enemies.some((enemy) => enemy.aliveState !== "removed")) throw new Error("Success requires every active enemy to be removed");
    if (outcome === "defeat" && (heroes.length === 0 || heroes.some((hero) => hero.aliveState !== "critically_injured"))) {
      throw new Error("Defeat requires every hero to be critically injured");
    }
    const rewardUnlocked = outcome === "success";
    const pendingEvents: PendingJournalEvent[] = [];
    for (const candidate of heroes.sort((a, b) => a.id.localeCompare(b.id))) {
      if (candidate.kind !== "hero") continue;
      const hero = candidate;
      for (const protection of [...hero.protections].sort((a, b) => a.id.localeCompare(b.id))) {
        pendingEvents.push({ event: { ...eventBase(this.runtime, this.runtime.serverTick, null, null), eventType: "protection.expired",
          payload: { heroId: hero.id, protectionId: protection.id, kind: protection.kind, reason: "battle_ended" }, replay: null } });
      }
      hero.protections = [];
      hero.statuses = [];
      hero.cards.nextHandRotationAtTick = null;
      if (hero.mode !== null) {
        pendingEvents.push(modeChangedEvent(this.runtime, hero, hero.mode, null, "scene_end", this.runtime.serverTick, {
          requestId: null,
          actorId: null,
        }));
        hero.mode = null;
      }
    }
    this.runtime.scene.contactImmunityUntilTick.clear();
    this.runtime.activeIntents.clear();
    for (const enemy of enemies) if (enemy.kind === "enemy") enemy.activeIntentId = null;
    this.runtime.paused = false;
    this.runtime.outcome = outcome;
    this.runtime.phase = "ended";
    pendingEvents.push({ event: { ...eventBase(this.runtime, this.runtime.serverTick, null, null),
      eventType: "campaign.outcome_confirmed", payload: { outcome, rewardUnlocked, ...(reason?.trim() ? { reason: reason.trim() } : {}) }, replay: null } });
    const committed = groupEvents(this.runtime, pendingEvents);
    const event = committed.events.find((candidate) => candidate.eventType === "campaign.outcome_confirmed");
    if (!event) throw new Error("Campaign outcome event was not committed");
    this.journal.appendBatch(committed.events, committed.auditByEventId);
    assertRuntimeInvariants(this.runtime);
    return { snapshot: this.snapshot(), event: structuredClone(event), rewardUnlocked };
  }

  private applyMove(command: InternalPlayerMoveCommand, reservations: ReadonlySet<number>): AppliedCommand {
    const heroId = this.runtime.heroIdByActorId.get(command.actorId);
    const hero = heroId ? this.runtime.entities.get(heroId) : undefined;
    const reject = (code: EngineErrorCode): AppliedCommand => ({
      result: { requestId: command.requestId, status: "rejected", code, sceneRevision: this.runtime.sceneRevision },
      pendingEvents: [],
    });
    if (!hero || hero.kind !== "hero" || hero.aliveState !== "active") return reject("AUTH_FORBIDDEN");
    if (hero.mode !== "movement") return reject("INVALID_MODE");
    if (hasActiveStatus(hero, "immobilized", this.runtime.serverTick)) return reject("ENTITY_UNABLE_TO_ACT");

    const validated = validateMove(this.runtime.scene.cells, hero.position, command.payload.direction, reservations);
    if (!validated.ok) return reject(validated.code);
    const from = { ...hero.position };
    const fromCell = this.runtime.scene.cells[validated.fromIndex];
    const toCell = this.runtime.scene.cells[validated.toIndex];
    if (!fromCell || !toCell || fromCell.occupantId !== hero.id || toCell.occupantId !== null) return reject("INVALID_STATE");

    fromCell.occupantId = null;
    toCell.occupantId = hero.id;
    hero.position = { ...validated.destination };
    const pendingEvents: PendingJournalEvent[] = [{
      event: {
        protocolVersion: "fable.protocol.v1",
        schemaVersion: 1,
        eventType: "scene.entity_moved",
        eventVersion: 1,
        campaignId: this.runtime.campaignId,
        sessionId: this.runtime.sessionId,
        sceneId: this.runtime.scene.id,
        serverTick: this.runtime.serverTick,
        causedByRequestId: command.requestId,
        actorId: command.actorId,
        replay: null,
        payload: { entityId: hero.id, from, to: { ...validated.destination } },
      },
    }];
    pendingEvents.push(...withDeckModeTransitions(this.runtime, detectContactTransitions(this.runtime, this.runtime.serverTick, {
      requestId: command.requestId,
      actorId: command.actorId,
    })));
    return {
      result: { requestId: command.requestId, status: "accepted", eventIds: [], sceneRevision: this.runtime.sceneRevision + 1 },
      pendingEvents,
      destinationCell: cellIndex(validated.destination),
    };
  }

  private applyModeCommand(command: InternalModeCommand): AppliedCommand {
    const heroId = this.runtime.heroIdByActorId.get(command.actorId);
    const hero = heroId ? this.runtime.entities.get(heroId) : undefined;
    const reject = (code: EngineErrorCode): AppliedCommand => ({
      result: { requestId: command.requestId, status: "rejected", code, sceneRevision: this.runtime.sceneRevision },
      pendingEvents: [],
    });
    if (!hero || hero.kind !== "hero" || hero.aliveState !== "active") return reject("AUTH_FORBIDDEN");
    const cause = { requestId: command.requestId, actorId: command.actorId };
    const pendingEvents: PendingJournalEvent[] = [];
    if (command.command === "player.enter_movement_mode") {
      if (hero.mode === "movement") return reject("INVALID_MODE");
      if (hero.mode === "melee") {
        pendingEvents.push(...resolveRetreat(this.runtime, hero, this.runtime.serverTick, command.requestId, command.actorId).events);
        pendingEvents.push(...detectContactTransitions(this.runtime, this.runtime.serverTick, cause));
      } else {
        const previousMode = hero.mode;
        hero.mode = "movement";
        pendingEvents.push(modeChangedEvent(this.runtime, hero, previousMode, hero.mode, "command", this.runtime.serverTick, cause));
        pendingEvents.push(...detectContactTransitions(this.runtime, this.runtime.serverTick, cause));
      }
    } else {
      if (hero.mode !== null && hero.mode !== "movement" && hero.mode !== "melee") return reject("INVALID_MODE");
      if (!hero.canEnterRangedMode) return reject("CARD_NOT_AVAILABLE");
      const previousMode = hero.mode;
      hero.mode = "ranged";
      pendingEvents.push(modeChangedEvent(this.runtime, hero, previousMode, hero.mode, "command", this.runtime.serverTick, cause));
      pendingEvents.push(...detectContactTransitions(this.runtime, this.runtime.serverTick, cause));
    }
    const transitionedEvents = withDeckModeTransitions(this.runtime, pendingEvents);
    return {
      result: { requestId: command.requestId, status: "accepted", eventIds: [], sceneRevision: this.runtime.sceneRevision + 1 },
      pendingEvents: transitionedEvents,
    };
  }

  private applyPlayCard(command: InternalPlayCardCommand): AppliedCommand {
    const resolution = resolvePlayCard(this.runtime, command);
    if (!resolution.ok) {
      return {
        result: { requestId: command.requestId, status: "rejected", code: resolution.code, sceneRevision: this.runtime.sceneRevision },
        pendingEvents: [],
      };
    }
    return {
      result: { requestId: command.requestId, status: "accepted", eventIds: [], sceneRevision: this.runtime.sceneRevision + 1 },
      pendingEvents: resolution.pendingEvents,
    };
  }

  private isValidCommand(command: InternalCommand): boolean {
    if (!command || typeof command !== "object") return false;
    if (typeof command.requestId !== "string" || command.requestId.length === 0 || command.requestId.length > 240 ||
      typeof command.sessionId !== "string" || command.sessionId.length === 0 ||
      typeof command.actorId !== "string" || command.actorId.length === 0) return false;
    if (Array.from(command.requestId).length > 120) return false;
    if (command.role !== "player") return false;
    if (command.command === "player.move") {
      if (!command.payload || !["up", "down", "left", "right"].includes(command.payload.direction)) return false;
      if (Object.keys(command.payload).sort().join(",") !== "direction") return false;
    } else if (command.command === "player.enter_movement_mode" || command.command === "player.enter_ranged_mode") {
      if (!command.payload || typeof command.payload !== "object" || Object.keys(command.payload).length !== 0) return false;
    } else if (command.command === "player.play_card") {
      const payload = command.payload;
      if (!payload || typeof payload !== "object" || typeof payload.cardInstanceId !== "string" || payload.cardInstanceId.length === 0 ||
        !["movement", "melee", "ranged"].includes(payload.mode) || !Number.isInteger(payload.clientCardRevision) || payload.clientCardRevision < 0) return false;
      if (payload.targetEntityId !== undefined && (typeof payload.targetEntityId !== "string" || payload.targetEntityId.length === 0)) return false;
      if (payload.targetCell !== undefined && (!payload.targetCell || !isInBounds(payload.targetCell) ||
        Object.keys(payload.targetCell).sort().join(",") !== "x,y")) return false;
      if (Object.keys(payload).some((key) => !["cardInstanceId", "targetEntityId", "targetCell", "mode", "clientCardRevision"].includes(key))) return false;
    } else return false;
    if (!Number.isInteger(command.clientRevision) || command.clientRevision < 0 ||
      !Number.isInteger(command.serverReceiveSequence) || command.serverReceiveSequence < 0) return false;
    const keys = Object.keys(command as unknown as Record<string, unknown>).sort();
    return keys.join(",") === ["actorId", "clientRevision", "command", "payload", "requestId", "role", "serverReceiveSequence", "sessionId"].sort().join(",");
  }
}

function extractRequestId(command: unknown): string {
  if (typeof command !== "object" || command === null || !("requestId" in command)) return "";
  const requestId = (command as { requestId?: unknown }).requestId;
  return typeof requestId === "string" ? requestId : "";
}

function requestKey(command: InternalCommand): string {
  return JSON.stringify([command.sessionId, command.actorId, command.requestId]);
}

export function createSimulationEngine(config: SimulationEngineConfig, options?: SimulationEngineOptions): SimulationEngine {
  return new HeadlessSimulationEngine(config, options);
}

export function createSimulationEngineFromSnapshot(
  snapshot: RuntimeSnapshot,
  config: SimulationEngineRestoreConfig,
  options?: SimulationEngineOptions,
): SimulationEngine {
  return HeadlessSimulationEngine.fromSnapshot(snapshot, config, options);
}

function cloneCommand(command: InternalCommand): InternalCommand {
  return structuredClone(command);
}

function withDeckModeTransitions(state: RuntimeState, events: readonly PendingJournalEvent[]): PendingJournalEvent[] {
  const result: PendingJournalEvent[] = [];
  for (const pending of events) {
    result.push(pending);
    if (pending.event.eventType !== "mode.changed") continue;
    const hero = state.entities.get(pending.event.payload.heroId);
    if (!hero || hero.kind !== "hero") throw new Error("mode.changed references a missing hero during deck transition");
    const from = pending.event.payload.from === "out_of_combat" ? null : pending.event.payload.from;
    const to = pending.event.payload.to;
    if (to === "melee" || to === "ranged") {
      result.push(...resolveModeEntryDeck(
        state,
        hero,
        to,
        from,
        pending.event.serverTick,
        { requestId: pending.event.causedByRequestId, actorId: pending.event.actorId },
      ));
    } else {
      stopHandRotation(hero);
    }
  }
  return result;
}

function rebaseTimers(state: RuntimeState, delta: number): void {
  if (delta <= 0) return;
  state.scene.startedAtTick += delta;
  for (const [heroId, untilTick] of state.scene.contactImmunityUntilTick) state.scene.contactImmunityUntilTick.set(heroId, untilTick + delta);
  for (const entity of state.entities.values()) {
    for (const status of entity.statuses) {
      status.appliedAtTick += delta;
      status.expiresAtTick += delta;
    }
    if (entity.kind === "hero") {
      if (entity.stamina.nextRegenAtTick !== null) entity.stamina.nextRegenAtTick += delta;
      if (entity.cards.nextHandRotationAtTick !== null) entity.cards.nextHandRotationAtTick += delta;
    }
  }
  for (const intent of state.activeIntents.values()) {
    intent.startedAtTick += delta;
    intent.resolvesAtTick += delta;
  }
}
