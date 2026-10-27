// End-to-end tests for the shareX server.
// Starts the real server (tsx server/src/index.ts) on a free port with small limits,
// then talks to it over HTTP and WebSocket. Uses only Node 22 built-ins.
//
// Run: npm run test:e2e

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";
const TSX = path.join(ROOT, "node_modules", ".bin", IS_WINDOWS ? "tsx.cmd" : "tsx");

// Small limits shared by every group; each group overrides what it needs.
const BASE_ENV = {
  MAX_CLIENTS_PER_ROOM: "3",
  CREATE_LIMIT_PER_MIN: "5",
  LOOKUP_LIMIT_PER_MIN: "20",
  MISS_LIMIT_PER_MIN: "5",
  MAX_SESSIONS: "3",
  SESSION_IDLE_MINUTES: "0.05", // 3 seconds
  SWEEP_INTERVAL_MS: "500",
};

const MAX_TEXT_LENGTH = 1_000_000;
const QUIET_MS = 300; // how long to wait before asserting that a message did NOT arrive

const results = [];
let currentServer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- server lifecycle ----------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (IS_WINDOWS) {
      // tsx.cmd runs through cmd.exe, so kill the whole process tree.
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM"); // negative pid = the process group
    }
  } catch {
    // already gone
  }
}

async function startServer(overrides) {
  const port = await freePort();
  const env = { ...process.env, ...BASE_ENV, ...overrides, PORT: String(port) };
  const child = spawn(IS_WINDOWS ? `"${TSX}"` : TSX, ["server/src/index.ts"], {
    cwd: ROOT,
    env,
    shell: IS_WINDOWS, // Node refuses to spawn .cmd files without a shell
    detached: !IS_WINDOWS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  currentServer = child;

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { child, port, base, wsBase: `ws://127.0.0.1:${port}` };
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  killTree(child);
  throw new Error(`server did not become healthy on port ${port}\n${output}`);
}

function stopServer() {
  killTree(currentServer);
  currentServer = null;
}

// Kill the server however the script ends.
process.on("exit", stopServer);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopServer();
    process.exit(130);
  });
}

// ---------- test helpers ----------

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${String(error?.message ?? error).split("\n").join("\n        ")}`);
  }
}

// Each group gets a fresh server so rate-limit budgets never leak between groups.
async function group(name, overrides, fn) {
  console.log(`\n${name}`);
  let server;
  try {
    server = await startServer(overrides);
  } catch (error) {
    results.push({ name: `${name}: server start`, ok: false });
    console.log(`  FAIL  server start\n        ${error.message}`);
    return;
  }
  try {
    await fn(server);
  } finally {
    stopServer();
    await sleep(200);
  }
}

async function createSession(base, headers = {}) {
  const res = await fetch(`${base}/api/sessions`, { method: "POST", headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, id: body?.id, body };
}

const lookup = (base, id, headers = {}) => fetch(`${base}/api/sessions/${id}`, { headers });

// Open a WebSocket and record everything it receives.
function connect(wsBase, id) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws/${id}`);
    const client = { ws, messages: [], closeCode: null, opened: false };
    const timer = setTimeout(() => reject(new Error(`connect to ${id} timed out`)), 5000);
    const rejectHandshake = (reason) => {
      if (client.opened) return;
      clearTimeout(timer);
      reject(new Error(`connection to ${id} was rejected (${reason})`));
    };
    ws.addEventListener("message", (event) => client.messages.push(JSON.parse(event.data)));
    // Node's WebSocket fires only "error" (no "close") when the server refuses the upgrade.
    ws.addEventListener("error", () => rejectHandshake("handshake error"));
    ws.addEventListener("close", (event) => {
      client.closeCode = event.code;
      rejectHandshake(`close code ${event.code}`);
    });
    ws.addEventListener("open", () => {
      client.opened = true;
      clearTimeout(timer);
      resolve(client);
    });
  });
}

async function waitFor(client, predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = client.messages.find(predicate);
    if (found) return found;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${label}; got ${JSON.stringify(client.messages).slice(0, 300)}`);
}

async function waitForClose(client, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (client.closeCode === null && Date.now() < deadline) await sleep(20);
  return client.closeCode;
}

const send = (client, msg) => client.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
const isUpdate = (text) => (m) => m.type === "update" && m.text === text;
const closeAll = (...clients) => clients.forEach((c) => c?.ws.close());

// The browser-style WebSocket hides the HTTP status of a rejected upgrade,
// so send the upgrade request by hand to see it.
function rawUpgradeStatus(port, id) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: `/ws/${id}`,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("shareX-e2e-key!!").toString("base64"),
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

// ---------- tests ----------

await group("REST API", {}, async ({ base }) => {
  let id;

  await test("health returns {ok:true}", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  await test("create returns 201 and a 4-digit id", async () => {
    const created = await createSession(base);
    assert.equal(created.status, 201);
    assert.match(String(created.id), /^\d{4}$/);
    id = created.id;
  });

  await test("lookup returns 200 for a valid id", async () => {
    const res = await lookup(base, id);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, id);
  });

  await test("lookup returns 404 for an unknown id", async () => {
    const unknown = id === "0000" ? "0001" : "0000";
    assert.equal((await lookup(base, unknown)).status, 404);
  });
});

await group("WebSocket sync", {}, async ({ base, wsBase, port }) => {
  const room = (await createSession(base)).id;
  const otherRoom = (await createSession(base)).id;
  let alice, bob, carol, late;

  try {
    await test("new client gets init with the current (empty) text", async () => {
      alice = await connect(wsBase, room);
      const init = await waitFor(alice, (m) => m.type === "init", "init");
      assert.equal(init.text, "");
    });

    await test("update is broadcast to others but not echoed to the sender", async () => {
      bob = await connect(wsBase, room);
      await waitFor(bob, (m) => m.type === "init", "bob init");
      send(alice, { type: "update", text: "hello from alice" });
      await waitFor(bob, isUpdate("hello from alice"), "broadcast to bob");
      await sleep(QUIET_MS);
      assert.ok(!alice.messages.some((m) => m.type === "update"), "sender received its own update");
    });

    await test("rooms are isolated", async () => {
      carol = await connect(wsBase, otherRoom);
      await waitFor(carol, (m) => m.type === "init", "carol init");
      send(alice, { type: "update", text: "only for room one" });
      await waitFor(bob, isUpdate("only for room one"), "broadcast to bob");
      await sleep(QUIET_MS);
      assert.ok(!carol.messages.some((m) => m.type === "update"), "update leaked into another room");
    });

    await test("late joiner gets the latest text", async () => {
      late = await connect(wsBase, room);
      const init = await waitFor(late, (m) => m.type === "init", "late init");
      assert.equal(init.text, "only for room one");
    });

    await test("connecting to an unknown session is rejected", async () => {
      const unknown = [room, otherRoom].includes("0000") ? "0001" : "0000";
      await assert.rejects(connect(wsBase, unknown), /rejected/);
      assert.equal(await rawUpgradeStatus(port, unknown), 404);
    });

    await test("malformed message is ignored and the server keeps working", async () => {
      send(alice, "not json{{");
      send(alice, { type: "update" }); // valid JSON, wrong shape
      send(alice, { type: "update", text: "still alive" });
      await waitFor(bob, isUpdate("still alive"), "update after malformed messages");
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
    });
  } finally {
    closeAll(alice, bob, carol, late);
  }
});

await group("Limits: document size and room size", {}, async ({ base, wsBase }) => {
  const room = (await createSession(base)).id;
  const clients = [];

  try {
    await test("text over 1,000,000 characters returns too-large and is not broadcast", async () => {
      clients.push(await connect(wsBase, room), await connect(wsBase, room));
      const [sender, receiver] = clients;
      await waitFor(receiver, (m) => m.type === "init", "init");
      send(sender, { type: "update", text: "x".repeat(MAX_TEXT_LENGTH + 1) });
      const error = await waitFor(sender, (m) => m.type === "error", "too-large error");
      assert.equal(error.code, "too-large");
      await sleep(QUIET_MS);
      assert.ok(!receiver.messages.some((m) => m.type === "update"), "oversized text was broadcast");
    });

    await test("text of exactly 1,000,000 characters is accepted", async () => {
      const [sender, receiver] = clients;
      const text = "y".repeat(MAX_TEXT_LENGTH);
      send(sender, { type: "update", text });
      const update = await waitFor(receiver, (m) => m.type === "update", "max-size update", 5000);
      assert.equal(update.text.length, MAX_TEXT_LENGTH);
    });

    await test("4th client in a room gets room-full and close code 4001", async () => {
      clients.push(await connect(wsBase, room)); // 3rd client: still allowed
      const fourth = await connect(wsBase, room);
      clients.push(fourth);
      const error = await waitFor(fourth, (m) => m.type === "error", "room-full error");
      assert.equal(error.code, "room-full");
      assert.equal(await waitForClose(fourth), 4001);
      assert.ok(clients.slice(0, 3).every((c) => c.closeCode === null), "an existing client was dropped");
    });
  } finally {
    closeAll(...clients);
  }
});

await group("Limits: create rate", { CREATE_LIMIT_PER_MIN: "3", MAX_SESSIONS: "100" }, async ({ base }) => {
  await test("create limit returns 429", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await createSession(base)).status);
    assert.deepEqual(statuses, [201, 201, 201, 429]);
  });
});

await group("Limits: lookup rate", { LOOKUP_LIMIT_PER_MIN: "4" }, async ({ base, port }) => {
  const id = (await createSession(base)).id;

  await test("lookup limit returns 429", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await lookup(base, id)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
  });

  await test("WebSocket upgrade is rejected once the lookup limit is hit", async () => {
    assert.equal(await rawUpgradeStatus(port, id), 429);
  });
});

await group("Limits: global miss rate", { MISS_LIMIT_PER_MIN: "5", LOOKUP_LIMIT_PER_MIN: "100" }, async ({ base }) => {
  await test("global miss limit returns 429 after repeated wrong codes, across client IPs", async () => {
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      // No sessions exist in this group, so every code is wrong.
      const res = await lookup(base, String(1000 + i), { "x-forwarded-for": `10.0.0.${i}` });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429, 429]);
  });
});

await group("Limits: session capacity", { MAX_SESSIONS: "2" }, async ({ base }) => {
  await test("MAX_SESSIONS returns 503", async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await createSession(base)).status);
    assert.deepEqual(statuses, [201, 201, 503]);
  });
});

await group("Idle expiry (TTL 3s, sweep 500ms)", {}, async ({ base, wsBase }) => {
  const idle = (await createSession(base)).id;
  const busy = (await createSession(base)).id;
  const client = await connect(wsBase, busy);

  try {
    await sleep(4500);

    await test("idle session with nobody connected expires", async () => {
      assert.equal((await lookup(base, idle)).status, 404);
    });

    await test("session with a connected client does not expire", async () => {
      assert.equal((await lookup(base, busy)).status, 200);
      assert.equal(client.closeCode, null);
    });
  } finally {
    closeAll(client);
  }
});

// ---------- summary ----------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("Failed:");
  for (const r of failed) console.log(`  - ${r.name}`);
}
process.exitCode = failed.length > 0 ? 1 : 0;
