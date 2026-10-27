import { Client, Room } from "colyseus.js";

type Role = "tv" | "gm" | "player";

export async function connectToCampaign(role: Role, campaignId: string, sceneId: string) {
  const client = new Client(import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:2567");
  const room: Room = await client.joinOrCreate("campaign", { role, campaignId, sceneId });

  room.onMessage("room.ready", (message) => {
    console.log("Connected", message);
  });

  room.onMessage("scene.spawn_accent", (event) => {
    // TV: pause renderer, play accent sound, darken scene,
    // show yellow rings, then keep the pause for event.durationMs.
    if (role === "tv") startNpcSpawnAccent(event.entityIds, event.durationMs);
  });

  room.onMessage("scene.entity_moved", (event) => {
    // TV and all relevant clients animate the confirmed position.
    console.log("Move confirmed", event);
  });

  room.onMessage("command.rejected", (event) => {
    // Show only to the client that issued the invalid command.
    console.warn("Command rejected", event.reason);
  });

  return {
    room,
    move(direction: "north" | "south" | "east" | "west") {
      if (role !== "player") throw new Error("Only players can move");
      room.send("player.move", { direction });
    },
    prepareSpawn(input: { requestId: string; templateId: string; count: number; side: "ally" | "enemy" | "neutral"; positions: { x: number; y: number }[] }) {
      if (role !== "gm") throw new Error("Only GM can prepare a spawn");
      room.send("gm.prepare_spawn", input);
    },
    confirmSpawn(input: { requestId: string; entityIds: string[] }) {
      if (role !== "gm") throw new Error("Only GM can confirm a spawn");
      room.send("gm.confirm_spawn", input);
    },
  };
}

function startNpcSpawnAccent(entityIds: string[], durationMs: number) {
  console.log("accent spawn", entityIds, durationMs);
  // Integrate with the TV renderer/audio layer here.
}
