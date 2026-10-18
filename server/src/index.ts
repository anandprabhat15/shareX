import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { SessionStore } from "./sessions.js";
import { RoomManager } from "./rooms.js";

const MAX_TEXT_LENGTH = 1_000_000;

const sessions = new SessionStore();
const rooms = new RoomManager();

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/sessions", (_req, res) => {
  const session = sessions.create();
  res.status(201).json({ id: session.id });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ id: session.id, createdAt: session.createdAt });
});

// In production the built client is served by this same server, so the app is one deployable unit.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: /s/:id and other client routes get index.html.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Express and WebSocket share one HTTP server (one port).
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_TEXT_LENGTH * 2 });

server.on("upgrade", (req, socket, head) => {
  const match = /^\/ws\/([\w-]+)$/.exec(new URL(req.url ?? "", "http://x").pathname);
  const sessionId = match?.[1];
  if (!sessionId || !sessions.get(sessionId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, sessionId);
  });
});

wss.on("connection", (ws, sessionId: string) => {
  rooms.join(sessionId, ws);
  // New client gets the current text first.
  ws.send(JSON.stringify({ type: "init", text: sessions.get(sessionId)?.text ?? "" }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== "update" || typeof msg.text !== "string") return;
      if (msg.text.length > MAX_TEXT_LENGTH) return;
      sessions.setText(sessionId, msg.text);
      rooms.broadcast(sessionId, ws, JSON.stringify({ type: "update", text: msg.text }));
    } catch {
      // Ignore malformed JSON instead of crashing the server.
    }
  });

  ws.on("close", () => rooms.leave(sessionId, ws));
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`shareX server running on http://localhost:${PORT}`);
});
