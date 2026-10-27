import http from "node:http";
import express from "express";
import { Server } from "colyseus";
import { CampaignRoom } from "./CampaignRoom.js";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = http.createServer(app);
const gameServer = new Server({ server: httpServer });
gameServer.define("campaign", CampaignRoom);

const port = Number(process.env.PORT ?? 2567);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Campaign server listening on http://0.0.0.0:${port}`);
});
