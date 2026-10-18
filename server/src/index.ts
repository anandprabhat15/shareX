import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { RateLimiter, clientIp } from "./rateLimit.js";
import { RoomManager } from "./rooms.js";
import { SessionStore, type Session } from "./sessions.js";

const sessions = new SessionStore({ maxSessions: config.maxSessions, idleTtlMs: config.idleTtlMs });
const rooms = new RoomManager();

const createLimiter = new RateLimiter(config.createLimitPerMin, 60_000);
const lookupLimiter = new RateLimiter(config.lookupLimitPerMin, 60_000);
// Failed lookups across all clients: slows down anyone guessing 4-digit codes.
const missLimiter = new RateLimiter(config.missLimitPerMin, 60_000);

type Lookup = { ok: true; session: Session } | { ok: false; status: 404 | 429 };

// Shared by the REST lookup and the WebSocket upgrade so both are rate limited.
function resolveSession(id: string, req: IncomingMessage): Lookup {
  if (!lookupLimiter.allow(clientIp(req))) return { ok: false, status: 429 };
  const session = sessions.get(id);
  if (session) return { ok: true, session };
  return { ok: false, status: missLimiter.allow("global") ? 404 : 429 };
}

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/sessions", (req, res) => {
  if (!createLimiter.allow(clientIp(req))) {
    res.status(429).json({ error: "Too many sessions created. Try again in a minute." });
    return;
  }
  const session = sessions.create();
  if (!session) {
    res.status(503).json({ error: "The server is full right now. Try again in a few minutes." });
    return;
  }
  res.status(201).json({ id: session.id });
});

app.get("/api/sessions/:id", (req, res) => {
  const result = resolveSession(req.params.id, req);
  if (!result.ok) {
    const error = result.status === 429 ? "Too many attempts. Try again in a minute." : "Session not found";
    res.status(result.status).json({ error });
    return;
  }
  res.json({ id: result.session.id, createdAt: result.session.createdAt });
});

// In production the built client is served by this same server, so the app is one deployable unit.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: client routes like /9807 get index.html.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Express and WebSocket share one HTTP server (one port).
const server = http.createServer(app);
// maxPayload is in bytes; a character can take up to 4 bytes, so leave room above the character limit.
const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxTextLength * 4 + 1024 });

server.on("upgrade", (req, socket, head) => {
  const match = /^\/ws\/([\w-]+)$/.exec(new URL(req.url ?? "", "http://x").pathname);
  const sessionId = match?.[1];
  const result = sessionId ? resolveSession(sessionId, req) : ({ ok: false, status: 404 } as const);
  if (!sessionId || !result.ok) {
    const status = result.ok ? 404 : result.status;
    socket.write(`HTTP/1.1 ${status} ${status === 429 ? "Too Many Requests" : "Not Found"}\r\n\r\n`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, sessionId);
  });
});

wss.on("connection", (ws, sessionId: string) => {
  if (rooms.count(sessionId) >= config.maxClientsPerRoom) {
    ws.send(JSON.stringify({ type: "error", code: "room-full", max: config.maxClientsPerRoom }));
    ws.close(4001, "room-full");
    return;
  }

  rooms.join(sessionId, ws);
  // New client gets the current text first.
  ws.send(JSON.stringify({ type: "init", text: sessions.get(sessionId)?.text ?? "" }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== "update" || typeof msg.text !== "string") return;
      if (msg.text.length > config.maxTextLength) {
        ws.send(JSON.stringify({ type: "error", code: "too-large", max: config.maxTextLength }));
        return;
      }
      sessions.setText(sessionId, msg.text);
      rooms.broadcast(sessionId, ws, JSON.stringify({ type: "update", text: msg.text }));
    } catch {
      // Ignore malformed JSON instead of crashing the server.
    }
  });

  ws.on("close", () => {
    rooms.leave(sessionId, ws);
    sessions.touch(sessionId); // the idle timer starts when the last person leaves
  });
});

setInterval(() => {
  const removed = sessions.sweep((id) => rooms.count(id) > 0);
  createLimiter.prune();
  lookupLimiter.prune();
  missLimiter.prune();
  if (removed > 0) console.log(`Expired ${removed} idle session(s)`);
}, config.sweepIntervalMs).unref();

server.listen(config.port, () => {
  console.log(`shareX server running on http://localhost:${config.port}`);
});
