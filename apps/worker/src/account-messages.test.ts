import { env, SELF, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DUPLEX_LIMITS, type MessagePage } from "@silvermoon-ai/sync-protocol/duplex";
import type { AppEnv } from "./env";
import { connectionTokenHash } from "./auth";
import { createSession } from "./session";
import type { MessagePrincipal, Result } from "./account-messages";
import { handleMessageApi } from "./message-api";

const appEnv = env as AppEnv;
let serial = 0;
const origin = "https://relay.silvermoon.work";
const key = () => crypto.randomUUID();
async function device(account = `duplex-${++serial}`, id = `device-${++serial}`) {
  const tokenId = String(++serial).padStart(16, "0"), secret = "d".repeat(43);
  await env.DB.prepare("INSERT OR IGNORE INTO users(id) VALUES (?)").bind(account).run();
  await env.DB.prepare("INSERT INTO devices(user_id,id,display_name) VALUES (?,?,?)").bind(account, id, id).run();
  await env.DB.prepare("INSERT INTO connection_tokens(id,user_id,device_id,secret_hash,scope) VALUES (?,?,?,?,'daemon:connect')")
    .bind(tokenId, account, id, await connectionTokenHash(tokenId, secret, appEnv.CONNECTION_TOKEN_PEPPER)).run();
  const owner = key();
  let generation = "0";
  const headers = () => ({ authorization: `Bearer smr1_${tokenId}_${secret}`, "content-type": "application/json",
    "x-device-generation": generation, "x-device-owner": owner });
  const call = (path: string, input?: object) => SELF.fetch(`${origin}/v2/devices/${id}/${path}`, {
    method: input ? "POST" : "GET", headers: headers(), ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const start = async (takeover = false) => {
    const response = await call("lease", { action: "acquire", owner, takeover });
    const value = await response.json() as { generation: string };
    generation = value.generation;
    return response;
  };
  return { account, id, tokenId, owner, headers, call, start,
    principal: { account, role: "device", device: id, token: tokenId } satisfies MessagePrincipal };
}
async function client(account: string, grant = true) {
  const session = await createSession(account, new Request(origin), appEnv);
  const headers = { cookie: `sm_session=${session.token}; sm_csrf=${session.csrf}`,
    "x-csrf-token": session.csrf, origin: appEnv.WEB_ORIGIN, "content-type": "application/json" };
  const call = (path: string, input?: object) => SELF.fetch(`${origin}/api/v2/${path}`, {
    method: input ? "POST" : "GET", headers, ...(input ? { body: JSON.stringify(input) } : {}),
  });
  if (grant) expect((await call("account/write-access", { enabled: true })).status).toBe(200);
  const sessionId = session.token.slice(5, 21);
  return { call, headers, sessionId, principal: { account, role: "client", session: sessionId } satisfies MessagePrincipal };
}
async function json<T>(response: Promise<Response>): Promise<T> {
  const value = await response;
  expect(value.status).toBe(200);
  return value.json() as Promise<T>;
}
async function page(response: Promise<Response>) { return json<MessagePage>(response); }
function value<T>(result: Result<T>): T {
  if ("error" in result) throw new Error(result.error);
  return result.value;
}

beforeAll(async () => {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS devices(user_id TEXT NOT NULL,id TEXT NOT NULL,display_name TEXT NOT NULL,removed_at TEXT,PRIMARY KEY(user_id,id));
    CREATE TABLE IF NOT EXISTS connection_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_id TEXT NOT NULL,secret_hash TEXT NOT NULL,scope TEXT NOT NULL,expires_at TEXT,revoked_at TEXT,last_used_at TEXT);
    CREATE TABLE IF NOT EXISTS browser_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,secret_hash TEXT NOT NULL,csrf_hash TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,user_agent TEXT);
  `);
});

describe("v2 account message coordination in real Workers SQLite", () => {
  it("routes all 2 Clients x 2 Devices combinations target-only and broadcasts every source to every Client", async () => {
    const d1 = await device(), d2 = await device(d1.account), outsider = await device();
    const [c1, c2, other] = await Promise.all([client(d1.account), client(d1.account), client(outsider.account)]);
    await Promise.all([d1.start(), d2.start(), outsider.start()]);
    for (const [ci, c] of [c1, c2].entries()) for (const d of [d1, d2]) {
      await json(c.call(`devices/${d.id}/regulations`, { key: key(), payload: { client: ci, target: d.id } }));
    }
    const [in1, in2] = await Promise.all([page(d1.call("regulations")), page(d2.call("regulations"))]);
    expect(in1.messages).toHaveLength(2);
    expect(in2.messages).toHaveLength(2);
    expect(in1.messages.every(m => m.device_id === d1.id && !m.is_upstream)).toBe(true);
    expect(in2.messages.every(m => m.device_id === d2.id && !m.is_upstream)).toBe(true);
    for (const d of [d1, d2]) await json(d.call("events", { key: key(), payload: { autonomous: d.id } }));
    const [p1, p2, p3] = await Promise.all([page(c1.call("account/events")), page(c2.call("account/events")), page(other.call("account/events"))]);
    expect(p1.messages).toEqual(p2.messages);
    expect(p1.messages.map(m => m.device_id).sort()).toEqual([d1.id, d2.id].sort());
    expect(p3.messages).toEqual([]);
    const newDevice = await device(d1.account);
    await newDevice.start();
    const waiting = [c1, c2].map(c => page(c.call(`account/events?after=${p1.next}&wait=2000`)));
    await new Promise(resolve => setTimeout(resolve, 50));
    const accepted = await json<{ id: string }>(newDevice.call("events", { key: key(), payload: "new source" }));
    for (const result of await Promise.all(waiting)) expect(result.messages.map(m => m.id)).toEqual([accepted.id]);
    expect((await page(other.call("account/events"))).messages).toEqual([]);
    expect((await c1.call(`devices/${outsider.id}/regulations`, { key: key(), payload: "denied" })).status).toBe(404);
    expect((await SELF.fetch(`${origin}/v2/devices/${d2.id}/regulations`, { headers: d1.headers() })).status).toBe(403);
  });

  it("requires explicit session write opt-in plus Origin/CSRF and never exchanges browser/device authority", async () => {
    const d = await device(), c = await client(d.account, false);
    await d.start();
    const submit = { key: key(), payload: null };
    expect((await c.call(`devices/${d.id}/regulations`, submit)).status).toBe(403);
    const path = `${origin}/api/v2/devices/${d.id}/regulations`;
    expect((await SELF.fetch(path, { method: "POST", headers: { ...c.headers, "x-csrf-token": "bad" }, body: JSON.stringify(submit) })).status).toBe(403);
    expect((await SELF.fetch(path, { method: "POST", headers: { ...c.headers, origin: "https://evil.example" }, body: JSON.stringify(submit) })).status).toBe(403);
    expect((await SELF.fetch(path, { method: "POST", headers: d.headers(), body: JSON.stringify(submit) })).status).toBe(403);
    expect((await SELF.fetch(`${origin}/v2/devices/${d.id}/events`, { method: "POST", headers: c.headers, body: JSON.stringify(submit) })).status).toBe(401);
    await json(c.call("account/write-access", { enabled: true }));
    await json(c.call(`devices/${d.id}/regulations`, submit));
    await json(c.call("account/write-access", { enabled: false }));
    expect((await c.call(`devices/${d.id}/regulations`, { key: key(), payload: "new" })).status).toBe(403);
  });

  it("atomically preserves original IDs after lost response and rejects content, target, producer or direction changes", async () => {
    const d = await device(), d2 = await device(d.account), c = await client(d.account), c2 = await client(d.account);
    await d.start();
    const request = { key: key(), payload: { b: 2, a: 1 } };
    const accepted = await json<{ id: string }>(c.call(`devices/${d.id}/regulations`, request));
    const retry = await json(c2.call(`devices/${d.id}/regulations`, { ...request, payload: { a: 1, b: 2 } }));
    expect(retry).toEqual(accepted);
    expect((await c.call(`devices/${d.id}/regulations`, { ...request, payload: "altered" })).status).toBe(409);
    expect((await c.call(`devices/${d2.id}/regulations`, request)).status).toBe(409);
    expect((await d.call("events", request)).status).toBe(409);
    expect((await page(d.call("regulations"))).messages).toHaveLength(1);
    const upstream = { key: key(), payload: "offline event" };
    const first = await json(d.call("events", upstream));
    expect(await json(d.call("events", upstream))).toEqual(first);
    expect((await page(c.call("account/events"))).messages).toHaveLength(1);
  });

  it("orders concurrent commits numerically above JSON safe integers, with rollback and committed gaps", async () => {
    const d = await device(), c = await client(d.account);
    await d.start();
    const stub = env.ACCOUNT_MESSAGES.getByName(d.account);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("INSERT INTO messages(account_id,device_id,is_upstream,payload,bytes) VALUES ('gap','gap',1,'null',4)");
      state.storage.sql.exec("DELETE FROM messages");
      state.storage.sql.exec("UPDATE sqlite_sequence SET seq=9007199254740991 WHERE name='messages'");
      state.storage.sql.exec(`CREATE TRIGGER reject_submission BEFORE INSERT ON submissions
        WHEN NEW.key='rollback-request-key' BEGIN SELECT RAISE(ABORT,'injected rollback'); END`);
    });
    expect((await d.call("events", { key: "rollback-request-key", payload: "must roll back" })).status).toBe(503);
    const accepted = await Promise.all(Array.from({ length: 15 }, (_, n) =>
      json<{ id: string }>(d.call("events", { key: key(), payload: n }))));
    expect(accepted.every(a => typeof a.id === "string" && BigInt(a.id) > 9007199254740991n)).toBe(true);
    const read = await page(c.call("account/events"));
    expect(read.messages.map(m => m.id)).toEqual(accepted.map(a => a.id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1));
    expect(new Set(read.messages.map(m => m.id)).size).toBe(15);
    expect(read.messages.some(m => m.payload === "must roll back")).toBe(false);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("INSERT INTO messages(account_id,device_id,is_upstream,payload,bytes) VALUES ('gap','gap',0,'null',4)");
      state.storage.sql.exec("DELETE FROM messages WHERE account_id='gap'");
    });
    const next = await json<{ id: string }>(d.call("events", { key: key(), payload: "after gap" }));
    expect(BigInt(next.id)).toBe(BigInt(read.next) + 2n);
    expect((await page(c.call(`account/events?after=${read.next}`))).messages.map(m => m.id)).toEqual([next.id]);
  });

  it("fences all stale writes, reads, long polls, progress and renewal after explicit takeover", async () => {
    const d = await device(), c = await client(d.account);
    await d.start();
    const stub = env.ACCOUNT_MESSAGES.getByName(d.account);
    const newOwner = key();
    expect(await stub.ownership(d.principal, "acquire", newOwner)).toMatchObject({ error: "lease_conflict" });
    const waiting = d.call("regulations?wait=2000");
    await new Promise(resolve => setTimeout(resolve, 30));
    const acquired = value(await stub.ownership(d.principal, "acquire", newOwner, "0", true));
    expect((await waiting).status).toBe(409);
    expect((await d.call("events", { key: key(), payload: "stale" })).status).toBe(409);
    expect((await d.call("regulations")).status).toBe(409);
    expect((await d.call("ack", { id: "1" })).status).toBe(409);
    expect((await d.call("lease", { action: "renew", owner: d.owner })).status).toBe(409);
    expect((await d.call("lease", { action: "release", owner: d.owner })).status).toBe(409);
    const accepted = value(await stub.append(d.principal, d.id, { key: key(), payload: "new owner" }, acquired.generation, newOwner));
    expect((await page(c.call("account/events"))).messages.map(m => m.id)).toEqual([accepted.id]);
  });

  it("reauthorizes waiting sessions and rejects revoked tokens, removed devices and deleted accounts", async () => {
    const d = await device(), c = await client(d.account);
    await d.start();
    const waiting = c.call("account/events?wait=2000");
    await new Promise(resolve => setTimeout(resolve, 30));
    await env.DB.prepare("UPDATE browser_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.sessionId).run();
    expect((await waiting).status).toBe(401);
    await env.DB.prepare("UPDATE connection_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(d.tokenId).run();
    expect((await d.call("events", { key: key(), payload: "revoked" })).status).toBe(401);
    const d2 = await device(d.account), valid = await client(d.account);
    await d2.start();
    await env.DB.prepare("UPDATE devices SET removed_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?").bind(d.account, d2.id).run();
    expect((await valid.call(`devices/${d2.id}/regulations`, { key: key(), payload: "removed" })).status).toBe(404);
    expect((await d2.call("regulations")).status).toBe(401);
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(d.account).run();
    expect((await valid.call("account/events")).status).toBe(401);
  });

  it("reports retention gaps, future cursors, bounded pages, payloads, rates and quota without silent cleanup", async () => {
    const d = await device(), c = await client(d.account);
    await d.start();
    for (let i = 0; i < 35; i++) await json(d.call("events", { key: key(), payload: i }));
    const first = await page(c.call("account/events"));
    expect(first.messages).toHaveLength(DUPLEX_LIMITS.page);
    const second = await page(c.call(`account/events?after=${first.next}`));
    expect(second.messages).toHaveLength(3);
    expect((await c.call("account/events?after=9223372036854775807")).status).toBe(409);
    expect((await d.call("events", { key: key(), payload: "x".repeat(17_000) })).status).toBe(413);
    expect((await c.call("account/events?wait=20001")).status).toBe(400);
    const stub = env.ACCOUNT_MESSAGES.getByName(d.account);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE metadata SET retained_after='5'");
    });
    const expired = await c.call("account/events");
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: "cursor_expired", retained_after: "5", retryable: false });
    expect((await page(c.call("account/events?after=5"))).messages).toHaveLength(30);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE messages SET bytes=? WHERE id=1", DUPLEX_LIMITS.accountBytes);
    });
    expect((await d.call("events", { key: key(), payload: "over quota" })).status).toBe(429);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("INSERT OR REPLACE INTO rate_limits VALUES (?,?,?)",
        `client:${c.sessionId}`, Math.floor(Date.now() / 60_000), DUPLEX_LIMITS.requestsPerMinute);
    });
    expect((await c.call("account/events?after=5")).status).toBe(429);
  });

  it("bounds independent long-poll windows; one Client cannot consume another's cursor", async () => {
    const d = await device(), c = await client(d.account), c2 = await client(d.account);
    await d.start();
    const stub = env.ACCOUNT_MESSAGES.getByName(d.account);
    const waiting = Array.from({ length: DUPLEX_LIMITS.subscriptions }, () => stub.read(c.principal, "0", "0", "", 500));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(await stub.read(c.principal, "0", "0", "", 100)).toMatchObject({ error: "backpressure", retryable: true });
    await json(d.call("events", { key: key(), payload: "broadcast" }));
    const pages = await Promise.all(waiting);
    expect(pages.map(result => JSON.parse(value(result)))).toEqual(Array(4).fill(await page(c2.call("account/events"))));
  });

  it("keeps ownership, receipt progress and request mapping through credential rotation; revokes an established Device poll", async () => {
    const d = await device(), c = await client(d.account);
    await d.start();
    const request = { key: key(), payload: "stable producer" };
    const accepted = await json(d.call("events", request));
    const regulation = await json<{ id: string }>(c.call(`devices/${d.id}/regulations`, { key: key(), payload: "receipt" }));
    await json(d.call("ack", { id: regulation.id }));
    const waiting = d.call(`regulations?after=${regulation.id}&wait=2000`);
    await new Promise(resolve => setTimeout(resolve, 30));
    await env.DB.prepare("UPDATE connection_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(d.tokenId).run();
    expect((await waiting).status).toBe(401);
    const tokenId = String(++serial).padStart(16, "0"), secret = "r".repeat(43);
    await env.DB.prepare("INSERT INTO connection_tokens(id,user_id,device_id,secret_hash,scope) VALUES (?,?,?,?,'daemon:connect')")
      .bind(tokenId, d.account, d.id, await connectionTokenHash(tokenId, secret, appEnv.CONNECTION_TOKEN_PEPPER)).run();
    const post = (path: string, body: object) => SELF.fetch(`${origin}/v2/devices/${d.id}/${path}`, {
      method: "POST", headers: { ...d.headers(), authorization: `Bearer smr1_${tokenId}_${secret}` }, body: JSON.stringify(body),
    });
    const renewed = await json<{ generation: string; ack: string }>(post("lease", { action: "renew", owner: d.owner }));
    expect(renewed).toMatchObject({ generation: "1", ack: regulation.id });
    expect(await json(post("events", request))).toEqual(accepted);
    expect((await page(c.call("account/events"))).messages).toHaveLength(1);
  });

  it("rejects a foreign Account even on the same internal object and stops cleanly at ID exhaustion", async () => {
    const d = await device(), other = await device(), c = await client(d.account), outsider = await client(other.account);
    await d.start();
    const stub = env.ACCOUNT_MESSAGES.getByName(d.account);
    expect(await stub.read(outsider.principal, "0")).toMatchObject({ error: "forbidden" });
    await json(d.call("events", { key: key(), payload: "last" }));
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE sqlite_sequence SET seq=9223372036854775807 WHERE name='messages'");
      state.storage.sql.exec("UPDATE metadata SET retained_after='1'");
    });
    const exhausted = await d.call("events", { key: key(), payload: "overflow" });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ error: "quota_exceeded", retryable: false });
    expect((await d.call("regulations")).status).toBe(410);
    expect((await page(c.call("account/events?after=1"))).messages).toEqual([]);
  });

  it("logs safe operation context for an unexpected atomic storage failure without logging expected rejection", async () => {
    const d = await device();
    await d.start();
    const stub = env.ACCOUNT_MESSAGES.getByName(d.account);
    const result = await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(`CREATE TRIGGER diagnostic_failure BEFORE INSERT ON submissions
        BEGIN SELECT RAISE(ABORT,'private-storage-error-secret'); END`);
      const logs: string[] = [], original = console.error;
      console.error = (message: string) => { logs.push(message); };
      try {
        const response = await instance.append(d.principal, d.id,
          { key: "private-request-key-secret", payload: "private-payload-secret" }, "1", d.owner);
        const expected = await instance.append(d.principal, d.id, { key: "bad", payload: null }, "1", d.owner);
        return { response, expected, logs };
      } finally { console.error = original; }
    });
    expect(result.response).toEqual({ error: "relay_unavailable", retryable: true });
    expect(result.expected).toEqual({ error: "invalid_request", retryable: false });
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      event: "account_messages.failed", operation: "append", failure: "unexpected_exception",
    });
    expect(JSON.parse(result.logs[0]).object_id).toMatch(/^[a-f0-9]+$/u);
    for (const privateText of ["private-storage-error-secret", "private-request-key-secret", "private-payload-secret", d.tokenId, d.owner]) {
      expect(result.logs[0]).not.toContain(privateText);
    }
    expect((await page(d.call("regulations"))).messages).toEqual([]);
  });

  it("logs safe route context and returns 503 for an unexpected RPC failure while expected auth errors remain quiet", async () => {
    const d = await device(), c = await client(d.account);
    const diagnostics: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation(message => { diagnostics.push(String(message)); });
    const brokenEnv = new Proxy(appEnv, {
      get(target, property) {
        if (property === "ACCOUNT_MESSAGES") return {
          getByName() { return { async read() { throw new Error("private-rpc-error-secret"); } }; },
        };
        return Reflect.get(target, property);
      },
    });
    try {
      const response = await handleMessageApi(new Request(`${origin}/api/v2/account/events?after=0&private=query-secret`, {
        headers: c.headers,
      }), brokenEnv);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "relay_unavailable", retryable: true });
      const denied = await handleMessageApi(new Request(`${origin}/api/v2/account/events`, {
        headers: { ...c.headers, origin: "https://not-authorized.example" },
      }), brokenEnv);
      expect(denied.status).toBe(403);
      expect(diagnostics).toHaveLength(1);
      expect(JSON.parse(diagnostics[0])).toEqual({
        event: "message_api.failed", operation: "events", role: "client", method: "GET", failure: "unexpected_exception",
      });
      for (const privateText of ["private-rpc-error-secret", "query-secret", c.headers.cookie, c.headers["x-csrf-token"]]) {
        expect(diagnostics[0]).not.toContain(privateText);
      }
    } finally { log.mockRestore(); }
  });
});
