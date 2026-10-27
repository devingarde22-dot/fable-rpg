import { TICK_DURATION_MS, TICK_RATE } from "../engine/types.js";

export class TickClock {
  constructor(private currentTick: number) {
    if (!Number.isInteger(currentTick) || currentTick < 0) throw new RangeError("tick must be a non-negative integer");
  }

  get tick(): number {
    return this.currentTick;
  }

  advance(): number {
    this.currentTick += 1;
    return this.currentTick;
  }

  static readonly rateHz = TICK_RATE;
  static readonly durationMs = TICK_DURATION_MS;
}
