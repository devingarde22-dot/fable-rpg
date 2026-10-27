import type { InternalCommand } from "../engine/types.js";
import { sortInputWindow } from "./InputWindow.js";

export type SchedulerPhase = "players" | "enemies" | "environment" | "resources" | "cards" | "statuses";

export function phaseOrder(): readonly SchedulerPhase[] {
  return ["players", "enemies", "environment", "resources", "cards", "statuses"];
}

export function orderCommands(commands: readonly InternalCommand[]): InternalCommand[] {
  return sortInputWindow(commands);
}
