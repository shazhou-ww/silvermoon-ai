import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import wrangler from "wrangler";
import { FileEventSource, LIMITS, SyncClient } from "../packages/connector/dist/sync.js";

// Use the exact Miniflare version that powers this repository's pinned Wrangler.
const tooling = createRequire(import.meta.resolve("wrangler"));
const { unstable_splitSqlQuery: splitSqlQuery } = wrangler;
const { Miniflare, convertV4MiniflareOptions } = tooling("miniflare");
const { WebSocket, WebSocketServer } = createRequire(new URL("../packages/connector/package.json", import.meta.url))("ws");
const state = resolve(".wrangler", `sync-smoke-${crypto.randomUUID()}`);
await mkdir(state, { recursive: true });
const pepper = randomBytes(32).toString("base64url");
const clients = new Set();
let runtime;
let source;
let proxy;
const checks = [];

async function start() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1",
    port: 0,
    resourcePersistencePath: join(state, "runtime"),
    isolatedResourcePersistencePath: join(state, "isolated"),
    workers: [{
    name: "silvermoon-sync-smoke",
    modules: true,
    scriptPath: resolve("apps", "worker", "dist", "index.js"),
    compatibilityDate: "2026-10-06",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "00000000-0000-4000-8000-000000000001" },
    durableObjects: {
      DAEMON_SESSIONS: { className: "DaemonSession", useSQLite: true },
      DEVICE_SYNC: { className: "DeviceSync", useSQLite: true },
    },
    bindings: {
      CONNECTION_TOKEN_PEPPER: pepper,
      AUTH_BASE_URL: "http://localhost",
      WEB_ORIGIN: "http://localhost",
    },
    }],
  }));
  const address = await runtime.ready;
  const health = await fetch(new URL("/health", address));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  assert.equal((await fetch(new URL("/v1/connect", address))).status, 426);
  return new URL("/v1/sync", address).href.replace(/^http/u, "ws");
}
async function seed(db, user, device) {
  const id = randomBytes(12).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const hash = createHmac("sha256", pepper).update(`${id}.${secret}`).digest("base64url");
  await db.prepare("INSERT OR IGNORE INTO users (id, display_name) VALUES (?, 'Sync smoke only')").bind(user).run();
  await db.prepare("INSERT OR IGNORE INTO devices (user_id, id, display_name) VALUES (?, ?, 'Smoke device')").bind(user, device).run();
  await db.prepare("INSERT INTO connection_tokens (id,user_id,device_id,secret_hash,token_hint,label) VALUES (?,?,?,?,?,'Smoke only')")
    .bind(id, user, device, hash, `smr1_${id}`).run();
  return { id, token: `smr1_${id}_${secret}` };
}
async function connect(url, auth, role = "writer", extra = {}) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const client = new SyncClient({ url, token: auth.token, role, requestTimeoutMs: 5_000, ...extra });
    clients.add(client);
    try { await client.connect(); return client; }
    catch (error) {
      client.close();
      clients.delete(client);
      if (error.code !== "writer_busy") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("writer lease not released");
}
function deliveries(capacity = LIMITS.windowEvents) {
  const queue = [];
  let waiting;
  let timer;
  return {
    receive: (frame) => {
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        clearTimeout(timer);
        resolve(frame);
      } else {
        assert.ok(queue.length < capacity, "test delivery queue exceeded its explicit bound");
        queue.push(frame);
      }
    },
    count: () => queue.length,
    wireBytes: () => queue.reduce((bytes, frame) => bytes + Buffer.byteLength(JSON.stringify(frame), "utf8"), 0),
    next: async () => {
      if (queue.length) return queue.shift();
      assert.equal(waiting, undefined, "test helper allows only one outstanding delivery wait");
      return new Promise((resolve, reject) => {
        waiting = resolve;
        timer = setTimeout(() => {
          waiting = undefined;
          reject(new Error("delivery timeout"));
        }, 5_000);
      });
    },
  };
}

try {
  let url = await start();
  checks.push("real runtime health and legacy /v1/connect Upgrade requirement");
  let db = await runtime.getD1Database("DB");
  for (const name of (await readdir(resolve("apps", "worker", "migrations"))).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(resolve("apps", "worker", "migrations", name), "utf8");
    for (const statement of splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  const auth = await seed(db, "smoke-account", "smoke-device");
  const rotated = await seed(db, "smoke-account", "smoke-device");
  const other = await seed(db, "other-account", "smoke-device");
  checks.push("existing D1 migrations + test-only HMAC credentials");
  const file = join(state, "producer.sqlite");
  source = await FileEventSource.create(file);
  await source.openStream("generic-smoke", "application/x-smoke");
  await source.append("generic-smoke", ['{"test": 1}', "opaque UTF-8 🎉"]);
  await source.openStream("window-smoke", "application/x-window-smoke");
  await source.append("window-smoke", Array(5).fill("x".repeat(LIMITS.payloadBytes)));
  let writer = await connect(url, auth);
  await writer.synchronize(source);
  const feed = deliveries();
  const reader = await connect(url, rotated, "reader", { onDelivery: feed.receive });
  const read = await reader.request({ type: "stream.read", streamId: "generic-smoke", after: "0", limit: 128 });
  assert.equal(read.type, "stream.events");
  assert.deepEqual(read.events.map((event) => event.seq), ["1", "2"]);
  await reader.request({ type: "stream.subscribe", streamId: "generic-smoke", after: "0", subscriptionId: "follow" });
  await source.append("generic-smoke", ["during catchup"]);
  await writer.synchronize(source);
  const delivered = [];
  for (let i = 0; i < 3; i++) delivered.push((await feed.next()).events[0].seq);
  assert.deepEqual(delivered, ["1", "2", "3"]);
  await reader.request({ type: "subscription.ack", subscriptionId: "follow", through: "2" });
  checks.push("real Node WebSocket append / historical read / race-free continuous catchup");
  const windowFeed = deliveries(3);
  const windowReader = await connect(url, rotated, "reader", { onDelivery: windowFeed.receive });
  await windowReader.request({ type: "stream.subscribe", streamId: "window-smoke", after: "0", subscriptionId: "window" });
  // Pong is an ordered wire barrier; absence assertions require no timing sleeps.
  await windowReader.request({ type: "ping" });
  assert.equal(windowFeed.count(), 3, "only three max-size events fit the byte window");
  assert.ok(windowFeed.wireBytes() <= LIMITS.windowBytes);
  const initialWindow = [];
  for (let i = 0; i < 3; i++) initialWindow.push((await windowFeed.next()).events[0].seq);
  assert.deepEqual(initialWindow, ["1", "2", "3"]);
  await windowReader.request({ type: "subscription.ack", subscriptionId: "window", through: "1" });
  await windowReader.request({ type: "ping" });
  assert.equal(windowFeed.count(), 1, "ACK 1 permits only event 4");
  await windowReader.request({ type: "subscription.ack", subscriptionId: "window", through: "1" });
  await windowReader.request({ type: "ping" });
  assert.equal(windowFeed.count(), 1, "duplicate ACK 1 adds no credit");
  await assert.rejects(windowReader.request({ type: "subscription.ack", subscriptionId: "window", through: "5" }), { code: "invalid_ack" });
  await windowReader.request({ type: "ping" });
  assert.equal(windowFeed.count(), 1, "overshoot ACK adds no credit");
  await windowReader.request({ type: "subscription.ack", subscriptionId: "window", through: "2" });
  await windowReader.request({ type: "ping" });
  assert.equal(windowFeed.count(), 2, "ACK 2 permits event 5");
  assert.deepEqual([(await windowFeed.next()).events[0].seq, (await windowFeed.next()).events[0].seq], ["4", "5"]);
  windowReader.close();
  checks.push("real byte-window backpressure: five 64-KiB events, 3-event initial window, exact/duplicate/overshoot ACK credit");
  const isolated = await connect(url, other, "reader");
  await assert.rejects(isolated.request({ type: "stream.read", streamId: "generic-smoke", after: "0", limit: 1 }), { code: "stream_not_found" });
  await assert.rejects(reader.request({ type: "stream.append", streamId: "generic-smoke", events: [{ seq: "4", payload: "forbidden" }] }), { code: "forbidden" });
  checks.push("cross-account isolation and reader write denial");

  writer.close();
  await source.append("generic-smoke", ["ACK deliberately lost"]);
  // Drop the durable ACK at a real WS proxy, before the Node connector can see it.
  proxy = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => proxy.once("listening", resolve));
  proxy.on("connection", (downstream, request) => {
    const upstream = new WebSocket(url, { headers: { authorization: request.headers.authorization } });
    const waiting = [];
    upstream.on("open", () => { for (const value of waiting) upstream.send(value); });
    downstream.on("message", (value) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(value.toString());
      else waiting.push(value.toString());
    });
    upstream.on("message", (value) => {
      const m = JSON.parse(value.toString());
      if (m.type === "stream.appended" && m.committedThrough === "4") {
        upstream.terminate();
        downstream.terminate();
      } else downstream.send(value.toString());
    });
    upstream.on("error", () => downstream.terminate());
    downstream.on("close", () => upstream.terminate());
  });
  const broken = await connect(`ws://127.0.0.1:${proxy.address().port}`, auth);
  await assert.rejects(broken.synchronize(source));
  writer = await connect(url, rotated);
  await writer.synchronize(source);
  assert.equal((await writer.request({ type: "stream.open", streamId: "generic-smoke" })).committedThrough, "4");
  await assert.rejects(writer.request({ type: "stream.append", streamId: "generic-smoke", events: [{ seq: "4", payload: "conflicting duplicate" }] }), { code: "event_conflict" });
  checks.push("actual wire ACK loss -> same-content replay; conflicting replay rejected");
  for (const client of clients) client.close();
  clients.clear();
  source.close();
  source = undefined;
  await runtime.dispose();
  runtime = undefined;
  url = await start();
  db = await runtime.getD1Database("DB");
  source = await FileEventSource.open(file);
  assert.deepEqual((await source.listStreams()).map(({ streamId, committedThrough }) => ({ streamId, committedThrough })), [
    { streamId: "generic-smoke", committedThrough: "4" },
    { streamId: "window-smoke", committedThrough: "5" },
  ]);
  writer = await connect(url, rotated);
  await writer.synchronize(source);
  assert.equal((await writer.request({ type: "stream.open", streamId: "window-smoke" })).committedThrough, "5");
  await source.append("generic-smoke", ["after process/runtime restart"]);
  await source.append("window-smoke", ["independent stream after restart"]);
  await writer.synchronize(source);
  const resumedFeed = deliveries();
  const resumed = await connect(url, rotated, "reader", { onDelivery: resumedFeed.receive });
  await resumed.request({ type: "stream.subscribe", streamId: "generic-smoke", after: "2", subscriptionId: "resume" });
  const resumedSeqs = [];
  for (let i = 0; i < 3; i++) resumedSeqs.push((await resumedFeed.next()).events[0].seq);
  assert.deepEqual(resumedSeqs, ["3", "4", "5"]);
  const independent = await resumed.request({ type: "stream.read", streamId: "window-smoke", after: "5", limit: 1 });
  assert.deepEqual(independent.events, [{ seq: "6", payload: "independent stream after restart" }]);
  checks.push("two independent source streams persist/reopen with separate heads and continue after runtime restart");
  checks.push("producer DB + whole Worker runtime restart preserve log; consumer resumes");
  await db.prepare("UPDATE connection_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(rotated.id).run();
  await assert.rejects(writer.request({ type: "stream.append", streamId: "generic-smoke", events: [{ seq: "6", payload: "revoked" }] }), { code: "unauthorized" });
  await assert.rejects(connect(url, rotated, "reader"), { code: "unauthorized" });
  const active = await connect(url, auth, "reader");
  await db.prepare("UPDATE devices SET removed_at=CURRENT_TIMESTAMP WHERE user_id='smoke-account' AND id='smoke-device'").run();
  await assert.rejects(active.request({ type: "stream.list", limit: 32 }), { code: "unauthorized" });
  checks.push("established connection revocation, removed device, rejected reconnect");
  console.log(JSON.stringify({ status: "passed", checks, stateRetained: process.env.SYNC_SMOKE_KEEP === "1", ...(process.env.SYNC_SMOKE_KEEP === "1" ? { state } : {}) }, null, 2));
} finally {
  for (const client of clients) client.close();
  source?.close();
  if (proxy) {
    for (const socket of proxy.clients) socket.terminate();
    await new Promise((resolve) => proxy.close(resolve));
  }
  await runtime?.dispose();
  if (process.env.SYNC_SMOKE_KEEP !== "1") await rm(state, { recursive: true, force: true });
}
