import { env, SELF, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { LIMITS, type ClientMessage, type ServerMessage } from "@silvermoon-ai/sync-protocol";
import { DeviceSync } from "./device-sync";
import { connectionTokenHash } from "./auth";
import type { AppEnv } from "./env";
import { createSession } from "./session";

const appEnv = env as AppEnv;
let serial = 0;
const sockets: WebSocket[] = [];

class Peer {
  private messages: ServerMessage[] = [];
  private wake?: () => void;
  private requestNumber = 0;
  constructor(readonly ws: WebSocket) {
    ws.accept();
    sockets.push(ws);
    ws.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(event.data as string) as ServerMessage);
      this.wake?.();
    });
  }
  async next(predicate: (message: ServerMessage) => boolean = () => true): Promise<ServerMessage> {
    const timeout = Date.now() + 3_000;
    while (Date.now() < timeout) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20);
        this.wake = () => { clearTimeout(timer); resolve(); };
      });
    }
    throw new Error(`timed out: ${JSON.stringify(this.messages).slice(0, 500)}`);
  }
  async request(message: Record<string, unknown>): Promise<ServerMessage> {
    const requestId = `r${++this.requestNumber}`;
    this.ws.send(JSON.stringify({ ...message, requestId }));
    return this.next((reply) => ("requestId" in reply && reply.requestId === requestId) || (reply.type === "error" && !reply.requestId));
  }
  deliveries(): ServerMessage[] { return this.messages.filter((m) => m.type === "subscription.events"); }
  errors(): ServerMessage[] { return this.messages.filter((m) => m.type === "error"); }
}

async function identity(user = `sync-user-${++serial}`, device = `device-${serial}`) {
  const id = String(++serial).padStart(16, "0");
  const secret = "x".repeat(43);
  await env.DB.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(user).run();
  await env.DB.prepare("INSERT OR IGNORE INTO devices (user_id,id,display_name) VALUES (?,?,?)").bind(user, device, device).run();
  await env.DB.prepare("INSERT INTO connection_tokens (id,user_id,device_id,secret_hash,scope) VALUES (?,?,?,?,'daemon:connect')")
    .bind(id, user, device, await connectionTokenHash(id, secret, appEnv.CONNECTION_TOKEN_PEPPER)).run();
  return { user, device, id, token: `smr1_${id}_${secret}`, stub: env.DEVICE_SYNC.getByName(JSON.stringify([user, device])) };
}
type Identity = Awaited<ReturnType<typeof identity>>;
async function connect(auth: Identity, role: "writer" | "reader" = "writer") {
  const response = await SELF.fetch("https://relay.silvermoon.work/v1/sync", {
    headers: { upgrade: "websocket", authorization: `Bearer ${auth.token}` },
  });
  expect(response.status).toBe(101);
  const peer = new Peer(response.webSocket!);
  const welcome = await peer.request({ type: "hello", version: 1, role });
  return { peer, welcome };
}
const append = (peer: Peer, events: { seq: string; payload: string }[], streamId = "s") =>
  peer.request({ type: "stream.append", streamId, events });
async function open(peer: Peer, streamId = "s", contentType?: string) {
  return peer.request({ type: "stream.open", streamId, ...(contentType ? { contentType } : {}) });
}

beforeAll(async () => {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS devices (user_id TEXT NOT NULL, id TEXT NOT NULL, display_name TEXT NOT NULL, removed_at TEXT, PRIMARY KEY(user_id,id));
    CREATE TABLE IF NOT EXISTS connection_tokens (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_id TEXT NOT NULL,secret_hash TEXT NOT NULL,scope TEXT NOT NULL,expires_at TEXT,revoked_at TEXT,last_used_at TEXT);
    CREATE TABLE IF NOT EXISTS browser_sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,secret_hash TEXT NOT NULL,csrf_hash TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,user_agent TEXT);
  `);
});
afterEach(() => { for (const ws of sockets.splice(0)) ws.close(1000, "test complete"); });

describe("DeviceSync actual Workers SQLite / WebSocket integration", () => {
  it("reads the actual device SQLite log with cookie-only ownership and Origin authorization", async () => {
    const auth = await identity();
    const other = await identity();
    const { peer } = await connect(auth);
    await open(peer, "s", "application/vnd.test.v1+json");
    await append(peer, [{ seq: "1", payload: '{"real":true}' }]);
    const session = await createSession(auth.user, new Request("https://relay.silvermoon.work"), appEnv);
    const otherSession = await createSession(other.user, new Request("https://relay.silvermoon.work"), appEnv);
    const headers = { cookie: `sm_session=${session.token}`, origin: appEnv.WEB_ORIGIN };
    const base = `https://relay.silvermoon.work/api/stream-connectors/${auth.device}`;
    const devices = await SELF.fetch("https://relay.silvermoon.work/api/stream-connectors", { headers });
    expect(await devices.json()).toMatchObject({ devices: [{ id: auth.device, status: "online" }] });
    const list = await SELF.fetch(`${base}/streams`, { headers });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ streams: [{ streamId: "s", committedThrough: "1", contentType: "application/vnd.test.v1+json" }] });
    const read = await SELF.fetch(`${base}/events?streamId=s&after=0`, { headers });
    expect(await read.json()).toMatchObject({ events: [{ seq: "1", payload: '{"real":true}' }], next: "1" });
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect((await SELF.fetch(`${base}/streams`, { headers: { ...headers, cookie: `sm_session=${otherSession.token}` } })).status).toBe(404);
    expect((await SELF.fetch(`${base}/streams`, { headers: { ...headers, cookie: "" } })).status).toBe(401);
    expect((await SELF.fetch(`${base}/streams`, { headers: { origin: appEnv.WEB_ORIGIN, authorization: `Bearer ${auth.token}` } })).status).toBe(401);
    expect((await SELF.fetch(`${base}/streams`, { headers: { cookie: headers.cookie } })).status).toBe(403);
    expect((await SELF.fetch(`${base}/streams`, { headers: { ...headers, origin: "https://evil.test" } })).status).toBe(403);
    expect((await SELF.fetch(`${base}/streams`, { method: "POST", headers })).status).toBe(405);
    expect((await SELF.fetch(`${base}/subscribe`, { headers: { cookie: headers.cookie, upgrade: "websocket" } })).status).toBe(403);
    expect((await SELF.fetch(`${base}/subscribe`, { headers: { ...headers, upgrade: "websocket", origin: "https://evil.test" } })).status).toBe(403);
    expect((await SELF.fetch(`${base}/events?streamId=s&after=9007199254740993`, { headers })).status).toBe(400);
    const collision = await identity(`collision-${serial}`, auth.device);
    const collisionSession = await createSession(collision.user, new Request("https://relay.silvermoon.work"), appEnv);
    const isolated = await SELF.fetch(`${base}/streams`, { headers: { ...headers, cookie: `sm_session=${collisionSession.token}` } });
    expect(await isolated.json()).toMatchObject({ streams: [], next: null });
    await env.DB.prepare("UPDATE connection_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(auth.id).run();
    expect((await SELF.fetch(`${base}/events?streamId=s&after=0`, { headers })).status).toBe(200);
    await env.DB.prepare("UPDATE devices SET removed_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?").bind(auth.user, auth.device).run();
    expect((await SELF.fetch(`${base}/streams`, { headers })).status).toBe(404);
  });

  it("forces browser subscriptions to reader, catches up without gaps and revalidates expiry and device removal on delivery/alarm", async () => {
    for (const revoke of ["expiry", "device", "session"] as const) {
      const auth = await identity();
      const { peer: writer } = await connect(auth);
      await open(writer);
      await append(writer, [{ seq: "1", payload: "history" }]);
      const session = await createSession(auth.user, new Request("https://relay.silvermoon.work"), appEnv);
      const headers = { cookie: `sm_session=${session.token}`, origin: appEnv.WEB_ORIGIN, upgrade: "websocket" };
      const url = `https://relay.silvermoon.work/api/stream-connectors/${auth.device}/subscribe`;
      const bad = await SELF.fetch(url, { headers });
      const noWriter = new Peer(bad.webSocket!);
      expect(await noWriter.request({ type: "hello", version: 1, role: "writer" })).toMatchObject({ type: "error", code: "forbidden" });
      noWriter.ws.close();
      const response = await SELF.fetch(url, { headers });
      expect(response.status).toBe(101);
      const browser = new Peer(response.webSocket!);
      expect(await browser.request({ type: "hello", version: 1, role: "reader" })).toMatchObject({ type: "welcome", generation: "0" });
      expect(await append(browser, [{ seq: "2", payload: "forbidden" }])).toMatchObject({ code: "forbidden" });
      await browser.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "browser" });
      expect(await browser.next(m => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "1", payload: "history" }] });
      await browser.request({ type: "subscription.ack", subscriptionId: "browser", through: "1" });
      await append(writer, [{ seq: "2", payload: "live" }]);
      expect(await browser.next(m => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "2", payload: "live" }] });
      if (revoke === "device") await env.DB.prepare("UPDATE devices SET removed_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?").bind(auth.user, auth.device).run();
      if (revoke !== "device") await env.DB.prepare(`UPDATE browser_sessions SET ${revoke === "expiry" ? "expires_at='2000-01-01'" : "revoked_at=CURRENT_TIMESTAMP"} WHERE user_id=?`).bind(auth.user).run();
      if (revoke === "expiry") await append(writer, [{ seq: "3", payload: "must not be delivered" }]);
      else await runDurableObjectAlarm(auth.stub);
      expect(await browser.next(m => m.type === "error")).toMatchObject({ code: "unauthorized" });
      expect(browser.deliveries()).toHaveLength(0);
    }
  });

  it("pages and locates a 100000-event actual SQLite history without full preload, preserving decimal identities above 2^53", async () => {
    const auth = await identity();
    const session = await createSession(auth.user, new Request("https://relay.silvermoon.work"), appEnv);
    await runInDurableObject(auth.stub, async (_instance, state) => {
      state.storage.sql.exec("INSERT INTO streams VALUES ('large','0000000000000100000',NULL)");
      state.storage.sql.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<100000)
        INSERT INTO events SELECT 'large',printf('%019d',n),'history-'||n,32 FROM numbers`);
      state.storage.sql.exec("INSERT INTO streams VALUES ('huge','0009007199254740994',NULL)");
      state.storage.sql.exec("INSERT INTO events VALUES ('huge','0009007199254740993','opaque',6),('huge','0009007199254740994','next',4)");
      state.storage.sql.exec("INSERT INTO streams VALUES ('wide','0000000000000000003',NULL)");
      for (const seq of ["1", "2", "3"]) state.storage.sql.exec("INSERT INTO events VALUES ('wide',?,?,?)", seq.padStart(19, "0"), "x".repeat(65536), 65536);
    });
    const headers = { cookie: `sm_session=${session.token}`, origin: appEnv.WEB_ORIGIN };
    const base = `https://relay.silvermoon.work/api/stream-connectors/${auth.device}/events`;
    const first = await (await SELF.fetch(`${base}?streamId=large&after=0`, { headers })).json<{ events: { seq: string }[]; next: string }>();
    expect(first.events).toHaveLength(128);
    expect(first.next).toBe("128");
    const located = await (await SELF.fetch(`${base}?streamId=large&after=99998`, { headers })).json<{ events: { seq: string }[] }>();
    expect(located.events.map(e => e.seq)).toEqual(["99999", "100000"]);
    const huge = await (await SELF.fetch(`${base}?streamId=huge&after=9007199254740992`, { headers })).json<{ events: { seq: string }[] }>();
    expect(huge.events.map(e => e.seq)).toEqual(["9007199254740993", "9007199254740994"]);
    const previous = await (await SELF.fetch(`${base}?streamId=wide&before=3`, { headers })).json<{ events: { seq: string }[]; after: string; next: string }>();
    expect(previous.events.map(e => e.seq)).toEqual(["2"]);
    expect(previous.after).toBe("1");
    expect(previous.next).toBe("2");
    const forward = await (await SELF.fetch(`${base}?streamId=wide&after=2`, { headers })).json<{ events: { seq: string }[] }>();
    expect(forward.events.map(e => e.seq)).toEqual(["3"]);
    const latest = await (await SELF.fetch(`${base}?streamId=wide&tail=1`, { headers })).json<{ events: { seq: string }[]; after: string }>();
    expect(latest.events.map(e => e.seq)).toEqual(["3"]);
    expect(latest.after).toBe("2");
    const hugeTail = await (await SELF.fetch(`${base}?streamId=huge&tail=1`, { headers })).json<{ events: { seq: string }[] }>();
    expect(hugeTail.events.map(e => e.seq)).toEqual(["9007199254740993", "9007199254740994"]);
  });
  it("persists immutable atomic batches, rejects gaps/conflicts, and replays an ACK-lost prefix", async () => {
    const auth = await identity();
    const { peer } = await connect(auth);
    expect(await open(peer, "s", "application/test")).toMatchObject({ type: "stream.opened", committedThrough: "0", retainedFrom: null });
    expect(await append(peer, [{ seq: "1", payload: "one" }, { seq: "2", payload: "two" }])).toMatchObject({ type: "stream.appended", committedThrough: "2" });
    expect(await append(peer, [{ seq: "1", payload: "one" }, { seq: "2", payload: "two" }, { seq: "3", payload: "three" }])).toMatchObject({ committedThrough: "3" });
    expect(await append(peer, [{ seq: "3", payload: "changed" }])).toMatchObject({ code: "event_conflict" });
    expect(await append(peer, [{ seq: "4", payload: "rollback me" }, { seq: "6", payload: "gap" }])).toMatchObject({ code: "sequence_gap", expected: "5" });
    expect(await open(peer)).toMatchObject({ committedThrough: "3", retainedFrom: "1", contentType: "application/test" });
    expect(await open(peer, "s", "different")).toMatchObject({ code: "content_type_conflict" });
    const rows = await runInDurableObject(auth.stub, async (_instance, state) => state.storage.sql.exec<{ seq: string }>("SELECT seq FROM events ORDER BY seq").toArray());
    expect(rows.map((row) => BigInt(row.seq).toString())).toEqual(["1", "2", "3"]);
    expect(await append(peer, [{ seq: "3", payload: "three" }])).toMatchObject({ committedThrough: "3" });
  });

  it("enforces writer/reader permissions, handshake and persistent fencing through reconstruction", async () => {
    const auth = await identity();
    const first = await connect(auth);
    expect(first.welcome.type).toBe("welcome");
    await open(first.peer);
    const second = await connect(auth);
    expect(second.welcome).toMatchObject({ code: "writer_busy" });
    const reader = await connect(auth, "reader");
    expect(await open(reader.peer, "new-stream")).toMatchObject({ code: "stream_not_found" });
    expect(await append(reader.peer, [{ seq: "1", payload: "no" }])).toMatchObject({ code: "forbidden" });
    expect(await reader.peer.request({ type: "stream.list" })).toMatchObject({ type: "stream.listed", streams: [{ streamId: "s" }] });
    await runInDurableObject(auth.stub, async (_instance, state) => {
      const rebuilt = new DeviceSync(state, env);
      const writerSocket = state.getWebSockets().find((ws) => {
        const { id } = ws.deserializeAttachment() as { id: string };
        const row = state.storage.sql.exec<{ state: string }>("SELECT state FROM sync_connections WHERE id=?", id).one();
        return (JSON.parse(row.state) as { role: string; ready: boolean }).role === "writer";
      })!;
      const m: ClientMessage = { type: "stream.append", requestId: "rebuilt", streamId: "s", events: [{ seq: "1", payload: "rebuilt" }] };
      await rebuilt.webSocketMessage(writerSocket, JSON.stringify(m));
    });
    expect(await first.peer.next((m) => "requestId" in m && m.requestId === "rebuilt")).toMatchObject({ type: "stream.appended", committedThrough: "1" });
    await runInDurableObject(auth.stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE writer SET expires=0");
    });
    const replacement = await connect(auth);
    expect(replacement.welcome).toMatchObject({ type: "welcome", generation: "2" });
    expect(await append(first.peer, [{ seq: "2", payload: "stale" }])).toMatchObject({ code: "stale_connection" });
    expect(await append(replacement.peer, [{ seq: "2", payload: "new" }])).toMatchObject({ type: "stream.appended", committedThrough: "2" });
  });

  it("continues durable subscriptions across catchup, concurrent appends, and DO reconstruction", async () => {
    const auth = await identity();
    const { peer } = await connect(auth);
    await open(peer);
    await append(peer, [{ seq: "1", payload: "one" }, { seq: "2", payload: "two" }]);
    const reader = (await connect(auth, "reader")).peer;
    expect(await reader.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "sub" })).toMatchObject({ type: "subscription.ready" });
    await append(peer, [{ seq: "3", payload: "during catchup" }]);
    const delivered = [];
    for (let i = 0; i < 3; i++) {
      const m = await reader.next((m) => m.type === "subscription.events");
      if (m.type === "subscription.events") delivered.push(m.events[0].seq);
    }
    expect(delivered).toEqual(["1", "2", "3"]);
    await runInDurableObject(auth.stub, async (_instance, state) => {
      const rebuilt = new DeviceSync(state, env);
      await rebuilt.alarm();
    });
    expect(await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "99" })).toMatchObject({ code: "invalid_ack" });
    expect(await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "2" })).toMatchObject({ through: "2" });
    expect(await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "2" })).toMatchObject({ through: "2" });
    await append(peer, [{ seq: "4", payload: "after rebuild" }]);
    expect(await reader.next((m) => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "4" }] });
    expect(await reader.request({ type: "stream.read", streamId: "s", after: "0", limit: 2 })).toMatchObject({ events: [{ seq: "1" }, { seq: "2" }], next: "2", committedThrough: "4" });
  });

  it("caps event window and duplicate/overshoot ACKs cannot enlarge it", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    await append(writer, Array.from({ length: 128 }, (_, i) => ({ seq: `${i + 1}`, payload: "x" })));
    await append(writer, [{ seq: "129", payload: "next" }, { seq: "130", payload: "last" }]);
    const reader = (await connect(auth, "reader")).peer;
    await reader.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "sub" });
    for (let i = 0; i < 128; i++) await reader.next((m) => m.type === "subscription.events");
    expect(await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "130" })).toMatchObject({ code: "invalid_ack" });
    expect(reader.deliveries()).toHaveLength(0);
    await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "1" });
    expect(await reader.next((m) => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "129" }] });
    await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "1" });
    expect(reader.deliveries()).toHaveLength(0);
    await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "2" });
    expect(await reader.next((m) => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "130" }] });
  });

  it("accepts the next append immediately after its ACK while reader fanout continues", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    const readers = [];
    for (let i = 0; i < 3; i++) {
      const reader = (await connect(auth, "reader")).peer;
      await reader.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "follow" });
      readers.push(reader);
    }
    for (let i = 1; i <= 20; i++) {
      expect(await append(writer, [{ seq: `${i}`, payload: `event ${i}` }])).toMatchObject({ type: "stream.appended", committedThrough: `${i}` });
    }
    for (const reader of readers) {
      const seqs = [];
      for (let i = 0; i < 20; i++) {
        const message = await reader.next((message) => message.type === "subscription.events");
        if (message.type === "subscription.events") seqs.push(message.events[0].seq);
      }
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => `${i + 1}`));
    }
  });

  it.each(["closing", "missing-state", "authorization-failure"] as const)("does not turn an ACKed append into producer failure when a fanout peer has %s", async (mode) => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    const reader = (await connect(auth, "reader")).peer;
    await reader.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "follow" });
    const diagnostics = await runInDurableObject(auth.stub, async (instance, state) => {
      const peers = state.getWebSockets().map((ws) => {
        const { id } = ws.deserializeAttachment() as { id: string };
        const row = state.storage.sql.exec<{ state: string }>("SELECT state FROM sync_connections WHERE id=?", id).one();
        return { ws, a: JSON.parse(row.state) as { id: string; role: string } };
      });
      const writerSocket = peers.find((peer) => peer.a.role === "writer")!.ws;
      const subscriber = peers.find((peer) => peer.a.role === "reader")!;
      const original = Reflect.get(instance, "authorized") as (a: { id: string }) => Promise<boolean>;
      const logs: string[] = [];
      const logError = console.error;
      console.error = (message: string) => { logs.push(message); };
      Object.defineProperty(instance, "authorized", { configurable: true, value: async (a: { id: string }) => {
        if (a.id !== subscriber.a.id) return original.call(instance, a);
        if (mode === "authorization-failure") throw new Error("injected subscriber D1 authorization failure");
        if (mode === "closing") subscriber.ws.close(1000, "peer closed during authorization");
        state.storage.sql.exec("DELETE FROM sync_connections WHERE id=?", subscriber.a.id);
        await Promise.resolve();
        return true;
      } });
      try {
        await instance.webSocketMessage(writerSocket, JSON.stringify({
          type: "stream.append", requestId: "fanout-append", streamId: "s", events: [{ seq: "1", payload: "durably accepted" }],
        }));
      } finally {
        Reflect.deleteProperty(instance, "authorized");
        console.error = logError;
      }
      return logs;
    });
    expect(await writer.next((message) => "requestId" in message && message.requestId === "fanout-append")).toMatchObject({ type: "stream.appended", committedThrough: "1" });
    expect(await writer.request({ type: "ping" })).toMatchObject({ type: "pong" });
    expect(writer.errors()).toHaveLength(0);
    if (mode !== "closing") {
      expect(await reader.next((message) => message.type === "error")).toMatchObject({ code: mode === "missing-state" ? "resubscribe_required" : "storage_error" });
      expect(diagnostics.some((line) => line.includes("sync_fanout_failed"))).toBe(true);
    }
    expect(await append(writer, [{ seq: "2", payload: "producer remains writable" }])).toMatchObject({ type: "stream.appended", committedThrough: "2" });
  });

  it("caps actual byte window, guarantees max event progress, and explicitly disconnects slow readers", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    const payload = "x".repeat(LIMITS.payloadBytes);
    for (let i = 1; i <= 5; i++) await append(writer, [{ seq: `${i}`, payload }]);
    const reader = (await connect(auth, "reader")).peer;
    await reader.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "sub" });
    const frames: ServerMessage[] = [];
    for (let i = 0; i < 3; i++) frames.push(await reader.next((m) => m.type === "subscription.events"));
    expect(frames.reduce((n, frame) => n + new TextEncoder().encode(JSON.stringify(frame)).byteLength, 0)).toBeLessThanOrEqual(LIMITS.windowBytes);
    await reader.request({ type: "ping" });
    expect(reader.deliveries()).toHaveLength(0);
    await reader.request({ type: "subscription.ack", subscriptionId: "sub", through: "1" });
    expect(await reader.next((m) => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "4" }] });
    await runInDurableObject(auth.stub, async (_instance, state) => {
      for (const row of state.storage.sql.exec<{ id: string; state: string }>("SELECT * FROM sync_connections").toArray()) {
        const a = JSON.parse(row.state);
        if (a.subscriptions.sub) {
          a.subscriptions.sub.pending[0].at = Date.now() - LIMITS.slowReaderMs - 1;
          state.storage.sql.exec("UPDATE sync_connections SET state=? WHERE id=?", JSON.stringify(a), row.id);
        }
      }
    });
    await runDurableObjectAlarm(auth.stub);
    expect(await reader.next((m) => m.type === "error")).toMatchObject({ code: "slow_consumer", retryable: true });
    const resumed = (await connect(auth, "reader")).peer;
    await resumed.request({ type: "stream.subscribe", streamId: "s", after: "1", subscriptionId: "resume" });
    expect(await resumed.next((m) => m.type === "subscription.events")).toMatchObject({ events: [{ seq: "2" }] });
  });

  it("isolates accounts/devices, rotates credentials without resetting identity, revokes established connections", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    await append(writer, [{ seq: "1", payload: "private" }]);
    const other = await identity("other-user", auth.device);
    const otherReader = (await connect(other, "reader")).peer;
    expect(await open(otherReader)).toMatchObject({ code: "stream_not_found" });
    const rotated = await identity(auth.user, auth.device);
    const read = (await connect(rotated, "reader")).peer;
    expect(await open(read)).toMatchObject({ committedThrough: "1" });
    await env.DB.prepare("UPDATE connection_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(auth.id).run();
    expect(await append(writer, [{ seq: "2", payload: "revoked" }])).toMatchObject({ code: "unauthorized" });
    const response = await SELF.fetch("https://relay.silvermoon.work/v1/sync", { headers: { upgrade: "websocket", authorization: `Bearer ${auth.token}` } });
    expect(response.status).toBe(401);
    const replacement = await connect(rotated);
    expect(replacement.welcome).toMatchObject({ type: "welcome", generation: "2" });
    expect(await open(replacement.peer)).toMatchObject({ committedThrough: "1" });
    await env.DB.prepare("UPDATE devices SET removed_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?").bind(auth.user, auth.device).run();
    await runDurableObjectAlarm(auth.stub);
    expect(await read.next((m) => m.type === "error")).toMatchObject({ code: "unauthorized" });
    expect(await replacement.peer.next((m) => m.type === "error")).toMatchObject({ code: "unauthorized" });
  });

  it("rejects invalid and excessive protocol resources explicitly", async () => {
    const auth = await identity();
    const { peer } = await connect(auth);
    await open(peer);
    expect(await peer.request({ type: "stream.read", streamId: "s", after: "1" })).toMatchObject({ code: "invalid_cursor" });
    for (let i = 0; i < LIMITS.subscriptions; i++) {
      expect(await peer.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: `sub${i}` })).toMatchObject({ type: "subscription.ready" });
    }
    expect(await peer.request({ type: "stream.subscribe", streamId: "s", after: "0", subscriptionId: "excess" })).toMatchObject({ code: "quota_exceeded" });
    const invalid = (await connect(await identity())).peer;
    expect(await invalid.request({ type: "stream.append", streamId: "s", events: [{ seq: "01", payload: "" }] })).toMatchObject({ code: "invalid_message" });
    const versionAuth = await identity();
    const response = await SELF.fetch("https://relay.silvermoon.work/v1/sync", { headers: { upgrade: "websocket", authorization: `Bearer ${versionAuth.token}` } });
    const version = new Peer(response.webSocket!);
    expect(await version.request({ type: "hello", version: 2, role: "writer" })).toMatchObject({ code: "unsupported_version" });
  });

  it("bounds connection count, stream count, and finite log quota without trimming history", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    await append(writer, [{ seq: "1", payload: "retained" }]);
    for (let i = 1; i < LIMITS.connections; i++) await connect(auth, "reader");
    const excess = await SELF.fetch("https://relay.silvermoon.work/v1/sync", { headers: { upgrade: "websocket", authorization: `Bearer ${auth.token}` } });
    expect(excess.status).toBe(429);
    await runInDurableObject(auth.stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE usage SET bytes=?", LIMITS.quotaBytes);
      for (let i = 1; i < LIMITS.streams; i++) state.storage.sql.exec("INSERT INTO streams VALUES (?, '0000000000000000000', NULL)", `filled-${i}`);
    });
    // A duplicate needs no additional retention quota and remains verifiable.
    expect(await append(writer, [{ seq: "1", payload: "retained" }])).toMatchObject({ type: "stream.appended" });
    expect(await append(writer, [{ seq: "2", payload: "must roll back" }])).toMatchObject({ code: "quota_exceeded" });
    const persisted = await runInDurableObject(auth.stub, async (_instance, state) => ({
      events: state.storage.sql.exec<{ payload: string }>("SELECT payload FROM events").toArray(),
      head: state.storage.sql.exec<{ head: string }>("SELECT head FROM streams WHERE id='s'").one().head,
    }));
    expect(persisted.events).toEqual([{ payload: "retained" }]);
    expect(BigInt(persisted.head)).toBe(1n);
    const streamAuth = await identity();
    const streamWriter = (await connect(streamAuth)).peer;
    await runInDurableObject(streamAuth.stub, async (_instance, state) => {
      for (let i = 0; i < LIMITS.streams; i++) state.storage.sql.exec("INSERT INTO streams VALUES (?, '0000000000000000000', NULL)", `filled-${i}`);
    });
    expect(await open(streamWriter)).toMatchObject({ code: "quota_exceeded" });
  });

  it("rolls back both event and head on actual SQLite storage failure and never emits a durable ACK", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    await runInDurableObject(auth.stub, async (_instance, state) => {
      state.storage.sql.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON events
        WHEN NEW.payload='fail' BEGIN SELECT RAISE(ABORT, 'injected disk/storage failure'); END`);
    });
    expect(await append(writer, [{ seq: "1", payload: "must roll back" }, { seq: "2", payload: "fail" }])).toMatchObject({ code: "storage_error", retryable: true });
    const persisted = await runInDurableObject(auth.stub, async (_instance, state) => ({
      n: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").one().n,
      head: state.storage.sql.exec<{ head: string }>("SELECT head FROM streams WHERE id='s'").one().head,
    }));
    expect(persisted.n).toBe(0);
    expect(BigInt(persisted.head)).toBe(0n);
    expect(writer.deliveries()).toHaveLength(0);
  });

  it("bounds lifetime wire output even for unacknowledged historical responses without fencing the producer", async () => {
    const auth = await identity();
    const writer = (await connect(auth)).peer;
    await open(writer);
    await append(writer, [{ seq: "1", payload: "retained" }]);
    const reader = (await connect(auth, "reader")).peer;
    await runInDurableObject(auth.stub, async (_instance, state) => {
      for (const row of state.storage.sql.exec<{ id: string; state: string }>("SELECT id,state FROM sync_connections").toArray()) {
        if (JSON.parse(row.state).role === "reader") state.storage.sql.exec("UPDATE sync_connections SET wire_bytes=? WHERE id=?", LIMITS.connectionOutputBytes, row.id);
      }
    });
    expect(await reader.request({ type: "stream.read", streamId: "s", after: "0", limit: 128 })).toMatchObject({ code: "quota_exceeded", retryable: true });
    expect(await append(writer, [{ seq: "2", payload: "producer unaffected" }])).toMatchObject({ type: "stream.appended", committedThrough: "2" });
  });

  it("rejects pre-handshake operations, excessive frames, and forged transport identities", async () => {
    const auth = await identity();
    const response = await SELF.fetch("https://relay.silvermoon.work/v1/sync", {
      headers: { upgrade: "websocket", authorization: `Bearer ${auth.token}`, "x-sync-user": "forged", "x-sync-device": "forged" },
    });
    const peer = new Peer(response.webSocket!);
    expect(await peer.request({ type: "stream.list" })).toMatchObject({ code: "handshake_required" });
    expect(await peer.request({ type: "hello", version: 1, role: "writer" })).toMatchObject({ type: "welcome" });
    await open(peer);
    expect(await peer.request({ type: "stream.append", streamId: "s", events: [{ seq: "1", payload: "x".repeat(LIMITS.frameBytes) }] })).toMatchObject({ code: "payload_too_large" });
    expect(await runInDurableObject(auth.stub, async (_instance, state) => state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM streams").one().n)).toBe(1);
  });
});
