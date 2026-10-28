import { describe, expect, it } from "vitest";
import { PlayerGmVerticalSlice } from "../src/index.js";
import { ENEMY_TEMPLATES, INTENT_TEMPLATES } from "../../content/src/index.js";
import { createSimulationEngineFromSnapshot } from "../../rules/src/index.js";

describe("player/GM vertical slice", () => {
  it("keeps GM and player projections separated", () => {
    const slice = new PlayerGmVerticalSlice();
    const player = slice.connect("player", "session-player-1", "player-1");
    const gm = slice.connect("gm", "session-gm");

    expect(player.projection().projection).toBe("player");
    const gmProjection = gm.projection();
    expect(gmProjection.projection).toBe("gm");
    if (gmProjection.projection !== "gm") throw new Error("Expected GM projection");
    expect(player.projection().entities.map((entity) => entity.id).sort()).toEqual(["enemy-chaser", "hero-1"]);
    expect(gm.projection().entities.map((entity) => entity.id).sort()).toEqual(["enemy-chaser", "hero-1", "hero-2"]);
    expect(gmProjection.activeIntents).toHaveLength(1);
  });

  it("accepts a player move through the authoritative engine and broadcasts it", () => {
    const slice = new PlayerGmVerticalSlice();
    const player = slice.connect("player", "session-player-1", "player-1");
    const gm = slice.connect("gm", "session-gm");
    player.drain();
    gm.drain();

    const messages = player.send({ kind: "player.move", requestId: "move-1", direction: "right" });
    const projection = player.projection();
    const hero = projection.entities.find((entity) => entity.id === "hero-1");

    expect(messages.some((message) => message.type === "events")).toBe(true);
    expect(messages.some((message) => message.type === "command.result" && message.result.status === "accepted")).toBe(true);
    expect(hero?.position).toEqual({ x: 2, y: 2 });
    expect(gm.drain().some((message) => message.type === "projection")).toBe(true);
  });

  it("rejects player commands while the GM has paused the scene", () => {
    const slice = new PlayerGmVerticalSlice();
    const player = slice.connect("player", "session-player-1", "player-1");
    const gm = slice.connect("gm", "session-gm");
    player.drain();
    gm.drain();

    gm.send({ kind: "gm.pause", requestId: "pause-1", paused: true });
    const pauseUpdates = player.drain();
    const playerProjections = pauseUpdates.filter((message) => message.type === "projection");
    expect(playerProjections).toHaveLength(1);
    expect(playerProjections[0]?.type === "projection" ? playerProjections[0].projection.projection : undefined).toBe("player");
    expect(pauseUpdates.some((message) => message.type === "projection" && message.projection.projection === "gm")).toBe(false);
    const messages = player.send({ kind: "player.move", requestId: "move-paused", direction: "right" });

    expect(messages).toContainEqual({ type: "command.result", requestId: "move-paused", result: { status: "rejected", reason: "scene_paused" } });
    expect(player.projection().timePaused).toBe(true);
  });

  it("restores a paused snapshot and keeps a reconnecting player in the same paused state", () => {
    const original = new PlayerGmVerticalSlice();
    const gm = original.connect("gm", "session-gm");
    gm.drain();
    gm.send({ kind: "gm.pause", requestId: "pause-restore", paused: true });

    const snapshot = original.engine.snapshot();
    const restored = new PlayerGmVerticalSlice(createSimulationEngineFromSnapshot(snapshot, {
      enemyTemplates: ENEMY_TEMPLATES.filter((template) => template.key === "quarantine_chaser"),
      intentTemplates: INTENT_TEMPLATES.filter((template) => ["move_close", "melee_strike", "hold_position"].includes(template.key)),
      terrain: [{ cell: { x: 4, y: 2 }, terrain: "wall" }, { cell: { x: 4, y: 3 }, terrain: "wall" }],
    }));
    const player = restored.connect("player", "reconnected-player", "player-1");
    expect(player.projection().timePaused).toBe(true);
    expect(player.send({ kind: "player.move", requestId: "move-after-restore", direction: "right" })).toContainEqual({
      type: "command.result",
      requestId: "move-after-restore",
      result: { status: "rejected", reason: "scene_paused" },
    });
  });

  it("prevents a player from using GM controls and lets GM close the expedition", () => {
    const slice = new PlayerGmVerticalSlice();
    const player = slice.connect("player", "session-player-1", "player-1");
    const gm = slice.connect("gm", "session-gm");
    player.drain();
    gm.drain();

    expect(player.send({ kind: "gm.pause", requestId: "not-allowed", paused: true })).toContainEqual({
      type: "command.result",
      requestId: "not-allowed",
      result: { status: "rejected", reason: "gm_role_required" },
    });

    gm.send({ kind: "gm.end_expedition", requestId: "end-1", outcome: "retreat", reason: "slice test" });
    const gmProjection = gm.projection();
    if (gmProjection.projection !== "gm") throw new Error("Expected GM projection");
    expect(gmProjection.outcome).toBe("retreat");
    expect(gmProjection.availableCommands).toContain("gm.end_expedition");
  });
});
