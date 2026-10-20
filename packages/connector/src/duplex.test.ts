import { mkdir, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DUPLEX_LIMITS, type Message } from "@silvermoon-ai/sync-protocol/duplex";
import { DeviceConnector, DuplexError } from "./duplex.js";
import { duplexMain, runDuplexCommand } from "./duplex-cli.js";

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function path() {
  const dir = resolve(`.duplex-test-${crypto.randomUUID()}`);
  await mkdir(dir);
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return resolve(dir, "state.sqlite");
}
function relay() {
  const messages: Message[] = [], keys = new Map<string, { id: string; payload: string }>();
  const requests: { path: string; token: string | null; body: Record<string, unknown> }[] = [];
  let generation = 0, owner = "", ack = "0", expires = 0;
  let dropAppend = false, dropAck = false, unavailable = false, expired = false;
  const fetcher: typeof fetch = async (input, init) => {
    if (unavailable) throw new Error("offline");
    if (init?.signal?.aborted) throw new Error("aborted");
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ path: url.pathname, token: headers.get("authorization"), body });
    const error = (error: string, retryable = false, status = 409) => Response.json({ error, retryable }, { status });
    if (url.pathname.endsWith("/lease") && body.action === "acquire") {
      if (owner && owner !== body.owner && expires > Date.now() && !body.takeover) return error("lease_conflict", true);
      if (owner !== body.owner || expires <= Date.now()) generation++;
      owner = body.owner as string;
      expires = Date.now() + 60_000;
      return Response.json({ generation: String(generation), expires, ack });
    }
    if (headers.get("x-device-generation") !== String(generation) || headers.get("x-device-owner") !== owner || expires <= Date.now()) return error("stale_generation");
    if (url.pathname.endsWith("/lease")) {
      expires = body.action === "release" ? 0 : Date.now() + 60_000;
      return Response.json({ generation: String(generation), expires, ack });
    }
    if (url.pathname.endsWith("/events")) {
      const old = keys.get(body.key as string), payload = JSON.stringify(body.payload);
      if (old && old.payload !== payload) return error("idempotency_conflict");
      const id = old?.id ?? String(messages.length + 1);
      if (!old) {
        keys.set(body.key as string, { id, payload });
        messages.push({ id, account_id: "a", device_id: "d", is_upstream: true, payload: body.payload as string });
      }
      if (dropAppend) { dropAppend = false; throw new Error("lost committed response"); }
      return Response.json({ status: "accepted", id });
    }
    if (url.pathname.endsWith("/ack")) {
      ack = body.id as string;
      if (dropAck) { dropAck = false; throw new Error("lost ack response"); }
      return Response.json({ ack });
    }
    if (expired) return Response.json({ error: "cursor_expired", retryable: false, retained_after: "10" }, { status: 410 });
    const after = url.searchParams.get("after") ?? "0";
    const batch = messages.filter(m => !m.is_upstream && BigInt(m.id) > BigInt(after)).slice(0, DUPLEX_LIMITS.page);
    return Response.json({ messages: batch, next: batch.at(-1)?.id ?? after, retained_after: "0" });
  };
  return {
    messages, keys, requests, fetcher, ack: () => ack,
    setAck: (value: string) => { ack = value; },
    dropAppend: () => { dropAppend = true; }, dropAck: () => { dropAck = true; },
    offline: (value: boolean) => { unavailable = value; },
    expire: () => { expired = true; }, fence: () => { generation++; },
    down: (payload: string) => {
      const m: Message = { id: String(messages.length + 1), account_id: "a", device_id: "d", is_upstream: false, payload };
      messages.push(m); return m;
    },
  };
}
async function connector(r: ReturnType<typeof relay>, statePath = "", create = true, token = () => "credential-1", attempts = 1) {
  const c = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "a", deviceId: "d",
    statePath: statePath || await path(), token, fetch: r.fetcher, attempts });
  await c.initialize({ create });
  cleanups.push(() => c.stop().catch(() => {}));
  return c;
}

describe("generic durable Device connector", () => {
  it("constructs without network, files, credential reads, logs or process lifecycle ownership", async () => {
    let calls = 0;
    const c = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "a", deviceId: "d",
      statePath: "must-not-be-opened", token: () => { calls++; throw new Error(); },
      fetch: async () => { calls++; throw new Error(); } });
    expect(calls).toBe(0);
    expect(() => c.state()).toThrow("not_initialized");
    expect(() => c.enqueue("not initialized")).toThrow("not_initialized");
    await c.stop();
    expect(calls).toBe(0);
    await expect(readFile("must-not-be-opened")).rejects.toThrow();
  });

  it("durably queues offline, retries lost acceptance by the same key and preserves mappings on restart/token rotation", async () => {
    const r = relay(), file = await path();
    let token = "first-token";
    const c = await connector(r, file, true, () => token, 2);
    r.offline(true);
    const queued = c.enqueue({ independent: true });
    expect(queued).toMatchObject({ status: "queued", remoteId: null });
    expect(r.requests).toHaveLength(0);
    r.offline(false);
    await c.start();
    r.dropAppend();
    const accepted = await c.flush();
    expect(accepted).toEqual([{ status: "accepted", key: queued.key, id: "1" }]);
    expect(r.messages).toHaveLength(1);
    expect(r.requests.filter(q => q.path.endsWith("/events")).map(q => q.body.key)).toEqual([queued.key, queued.key]);
    token = "rotated-token";
    c.enqueue("after rotation");
    await c.flush();
    expect(r.requests.at(-1)?.token).toBe("Bearer rotated-token");
    await c.stop();
    const reopened = await connector(r, file, false, () => token);
    expect(reopened.state()).toMatchObject({ accountId: "a", deviceId: "d", accepted: 2, queued: 0 });
    expect(reopened.enqueue({ independent: true }, queued.key).remoteId).toBe("1");
    expect(() => reopened.enqueue("changed", queued.key)).toThrow("idempotency_conflict");
    await reopened.start();
    expect(await reopened.flush()).toEqual([]);
  });

  it("keeps unknown remote acceptance queued after crash and recovers the exact remote ID", async () => {
    const r = relay(), file = await path(), c = await connector(r, file);
    await c.start();
    const queued = c.enqueue("unknown outcome");
    r.dropAppend();
    await expect(c.flush()).rejects.toMatchObject({ code: "transport_unavailable", retryable: true });
    expect(c.state()).toMatchObject({ queued: 1, accepted: 0 });
    await c.stop();
    const next = await connector(r, file, false);
    await next.start();
    expect(await next.flush()).toEqual([{ status: "accepted", key: queued.key, id: "1" }]);
    expect(r.messages).toHaveLength(1);
  });

  it("persists inbox before delivery, never auto-ACKs, redelivers across restart and only ACKs host durable receipt", async () => {
    const r = relay(), file = await path(), c = await connector(r, file);
    await c.start();
    const first = r.down("regulation-1"), second = r.down("regulation-2");
    expect(await c.receive()).toEqual([first, second]);
    expect(r.ack()).toBe("0");
    expect(c.state()).toMatchObject({ cursor: second.id, pending: 2 });
    await expect(c.acknowledge(second.id)).rejects.toMatchObject({ code: "ack_out_of_order" });
    await c.stop();
    const next = await connector(r, file, false);
    await next.start();
    expect(await next.receive()).toEqual([first, second]);
    const { durablyReceive } = await import("../examples/duplex-host.mjs");
    const host = new DatabaseSync(":memory:");
    cleanups.push(() => host.close());
    r.dropAck();
    await expect(durablyReceive(next, host)).rejects.toMatchObject({ code: "transport_unavailable" });
    expect(host.prepare("SELECT COUNT(*) AS count FROM host_receipts").get()!.count).toBe(1);
    expect(next.state().pending).toBe(2);
    expect(await durablyReceive(next, host)).toBe(2);
    expect(host.prepare("SELECT COUNT(*) AS count FROM host_receipts").get()!.count).toBe(2);
    expect(r.ack()).toBe(second.id);
    expect(next.state().pending).toBe(0);
    expect(await next.receive()).toEqual([]);
  });

  it("uses the same public operations for CLI receive/ack and never treats printed output as acknowledgement", async () => {
    const r = relay(), c = await connector(r);
    const message = r.down("cli observation");
    const observed = await runDuplexCommand(c, "receive");
    expect(JSON.parse(JSON.stringify(observed))).toEqual([message]);
    expect(r.ack()).toBe("0");
    expect(await runDuplexCommand(c, "state")).toMatchObject({ pending: 1 });
    expect(await runDuplexCommand(c, "ack", message.id)).toEqual({ acknowledged: message.id });
    expect(r.ack()).toBe(message.id);
    const out: string[] = [], error: string[] = [];
    expect(await duplexMain([], { out: x => out.push(x), error: x => error.push(x) })).toBe(1);
    expect(out).toEqual([]);
    expect(JSON.parse(error[0])).toHaveProperty("error");
  });

  it("fences online work after takeover and local mutations after a second instance claims the same state", async () => {
    const r = relay(), file = await path(), c = await connector(r, file);
    await c.start();
    const other = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "a", deviceId: "d",
      statePath: file, token: () => "rotated", fetch: r.fetcher });
    await expect(other.initialize()).rejects.toMatchObject({ code: "local_lease_conflict" });
    await other.initialize({ takeover: true });
    cleanups.push(() => other.stop().catch(() => {}));
    expect(() => c.enqueue("old local owner")).toThrow("local_lease_conflict");
    await other.start({ takeover: true });
    await expect(c.renew()).rejects.toMatchObject({ code: "local_lease_conflict" });
    const differentState = await connector(r);
    await expect(differentState.start()).rejects.toMatchObject({ code: "lease_conflict" });
    await differentState.start({ takeover: true });
    await expect(other.receive()).rejects.toMatchObject({ code: "stale_generation" });
    expect(other.state().fenced).toBe(true);
    expect(() => other.enqueue("known fenced")).toThrow("stale_generation");
    expect(r.messages).toEqual([]);
  });

  it("exposes terminal cursor loss, bounded retry exhaustion and local/remote backpressure", async () => {
    const r = relay(), c = await connector(r, "", true, () => "token", 2);
    await c.start();
    r.expire();
    await expect(c.receive()).rejects.toMatchObject({ code: "cursor_expired", retryable: false, retainedAfter: "10" });
    expect(c.state().cursor).toBe("0");
    expect(() => c.enqueue("x".repeat(17_000))).toThrow("payload_too_large");
    await expect(c.flush(33)).rejects.toThrow("invalid_limits");
    await expect(c.receive(20_001)).rejects.toThrow("invalid_limits");
    r.offline(true);
    c.enqueue("bounded failure");
    await expect(c.flush()).rejects.toMatchObject({ code: "transport_unavailable", retryable: true });
    expect(c.state().queued).toBe(1);
    r.offline(false);
    const file = await path(), limited = await connector(r, file);
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO outbox VALUES ('quota-test-key-0000',?,NULL)").run("x".repeat(DUPLEX_LIMITS.localBytes));
    db.close();
    expect(() => limited.enqueue("over capacity")).toThrow("local_backpressure");
  });

  it("rejects missing or wrong-identity state instead of silently recreating history", async () => {
    const r = relay(), file = await path();
    await expect(connector(r, file, false)).rejects.toMatchObject({ code: "local_state_unavailable" });
    const c = await connector(r, file);
    c.enqueue("preserved");
    await c.stop();
    const wrong = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "other", deviceId: "d",
      statePath: file, token: () => "token" });
    await expect(wrong.initialize()).rejects.toThrow("local_state_mismatch");
    const reopened = await connector(r, file, false);
    expect(reopened.state().queued).toBe(1);
  });

  it("times out a credential supplier without unbounded waiting or process exit", async () => {
    const c = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "a", deviceId: "d",
      statePath: await path(), token: () => new Promise<string>(() => {}), timeoutMs: 10, attempts: 1 });
    await c.initialize({ create: true });
    cleanups.push(() => c.stop());
    await expect(c.start()).rejects.toMatchObject({ code: "transport_unavailable", retryable: true });
    expect(c.state().started).toBe(false);
    expect(DuplexError.name).toBe("DuplexError");
  });

  it("rolls back the entire local inbox window and cursor if durable capacity runs out mid-page", async () => {
    const r = relay(), file = await path(), c = await connector(r, file);
    await c.start();
    r.down("first");
    r.down("second");
    const db = new DatabaseSync(file);
    db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<9999)
      INSERT INTO outbox SELECT printf('capacity-key-%05d',n),'null','1' FROM numbers`);
    db.close();
    await expect(c.receive()).rejects.toMatchObject({ code: "local_backpressure" });
    expect(c.state()).toMatchObject({ cursor: "0", pending: 0 });
    expect(r.ack()).toBe("0");
  });

  it("cancels an outstanding request on explicit stop and never retries a stopped operation", async () => {
    const r = relay();
    let entered!: () => void;
    const active = new Promise<void>(resolve => { entered = resolve; });
    let networkCalls = 0;
    const c = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "a", deviceId: "d",
      statePath: await path(), token: () => "token", attempts: 3,
      fetch: async (input, init) => {
        if (String(input).includes("regulations")) {
          networkCalls++;
          entered();
          return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
        }
        return r.fetcher(input, init);
      } });
    await c.initialize({ create: true });
    await c.start();
    const receiving = c.receive(20_000);
    const failed = expect(receiving).rejects.toMatchObject({ code: "stopped", retryable: false });
    await active;
    await c.stop();
    await failed;
    expect(networkCalls).toBe(1);
    expect(() => c.state()).toThrow("not_initialized");
  });

  it("permanently fail-closes a startup whose remote durable ACK is ahead of local state", async () => {
    const r = relay(), c = await connector(r);
    r.down("already confirmed by a lost local history");
    r.setAck("1");
    c.enqueue("still locally queued");
    await expect(c.start()).rejects.toMatchObject({ code: "local_state_lost", retryable: false });
    const requests = r.requests.length;
    expect(c.state()).toMatchObject({ started: false, fenced: true, cursor: "0", queued: 1, pending: 0 });
    await expect(c.receive()).rejects.toMatchObject({ code: "local_state_lost" });
    await expect(c.flush()).rejects.toMatchObject({ code: "local_state_lost" });
    expect(() => c.enqueue("must not mutate")).toThrow("local_state_lost");
    expect(() => c.pending()).toThrow("local_state_lost");
    await expect(c.renew()).rejects.toMatchObject({ code: "local_state_lost" });
    await expect(c.acknowledge("1")).rejects.toMatchObject({ code: "local_state_lost" });
    await expect(c.start()).rejects.toMatchObject({ code: "local_state_lost" });
    expect(r.requests).toHaveLength(requests);
    expect(c.state()).toMatchObject({ started: false, fenced: true, queued: 1, cursor: "0" });
    await c.stop();
    await expect(c.initialize()).rejects.toMatchObject({ code: "local_state_lost" });
    expect(r.requests).toHaveLength(requests);
  });

  it("cancels retry backoff and older queued operations immediately when the host stops", async () => {
    const r = relay();
    let calls = 0;
    const c = new DeviceConnector({ relayUrl: "https://relay.example", accountId: "a", deviceId: "d",
      statePath: await path(), token: () => "token", attempts: 3,
      fetch: async (input, init) => {
        if (String(input).endsWith("/events")) { calls++; throw new Error("retryable outage"); }
        return r.fetcher(input, init);
      } });
    await c.initialize({ create: true });
    await c.start();
    c.enqueue("pending");
    vi.useFakeTimers();
    try {
      const failed = expect(c.flush()).rejects.toMatchObject({ code: "stopped", retryable: false });
      const queued = expect(c.receive()).rejects.toMatchObject({ code: "stopped", retryable: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      await c.stop();
      await Promise.all([failed, queued]);
      expect(calls).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => c.state()).toThrow("not_initialized");
    } finally {
      vi.useRealTimers();
      await c.stop().catch(() => {});
    }
  });
});
