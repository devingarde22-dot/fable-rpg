import { INPUT_WINDOW_TICKS, type InternalCommand } from "../engine/types.js";

export function windowIdAtTick(tick: number): number {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError("tick must be a non-negative integer");
  return Math.floor(tick / INPUT_WINDOW_TICKS);
}

export function isWindowCloseTick(tick: number): boolean {
  return tick > 0 && tick % INPUT_WINDOW_TICKS === 0;
}

export function closedWindowIdAtTick(tick: number): number | null {
  return isWindowCloseTick(tick) ? windowIdAtTick(tick) - 1 : null;
}

export function sortInputWindow(commands: readonly InternalCommand[]): InternalCommand[] {
  return [...commands].sort((a, b) =>
    a.serverReceiveSequence - b.serverReceiveSequence ||
    compareText(a.actorId, b.actorId) ||
    compareText(a.requestId, b.requestId),
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
