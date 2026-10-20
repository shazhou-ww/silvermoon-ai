import { mkdir, rm, access } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { FileEventSource, SyncClient, runSync, type ReliableEventSource, type EventRecord } from "./sync.js";
import { LIMITS, parseClientMessage } from "@silvermoon-ai/sync-protocol";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanup.splice(0).reverse()) await clean(); });
async function sourceFile() {
  const dir = resolve(`.sync-test-${crypto.randomUUID()}`);
  await mkdir(dir);
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return resolve(dir, "events.sqlite");
}
function source(events: EventRecord[], head = events.at(-1)?.seq ?? "0"): ReliableEventSource {
  return {
    listStreams: async () => [{ streamId: "s", committedThrough: head }],
    read: async (_id, after, limit) => events.filter((event) => BigInt(event.seq) > BigInt(after)).slice(0, limit),
    waitForChange: async (signal) => { if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); },
  };
}
async function server(dropFirstAck = false) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  cleanup.push(async () => {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
  const streams = new Map<string, EventRecord[]>();
  const contentTypes = new Map<string, string>();
  const appends: EventRecord[][] = [];
  let drop = dropFirstAck;
  let latest: WebSocket | undefined;
  wss.on("connection", (ws) => {
    latest = ws;
    ws.on("message", (data) => {
      const m = parseClientMessage(data.toString());
      const send = (value: object) => ws.send(JSON.stringify({ requestId: m.requestId, ...value }));
      switch (m.type) {
        case "hello": send({ type: "welcome", version: 1, connectionId: crypto.randomUUID(), generation: "1", limits: LIMITS }); break;
        case "ping": send({ type: "pong" }); break;
        case "stream.list":
          send({ type: "stream.listed", streams: [...streams].map(([streamId, events]) => ({ streamId, committedThrough: events.at(-1)?.seq ?? "0", retainedFrom: events.length ? "1" : null })), next: null });
          break;
        case "stream.open":
          if (!streams.has(m.streamId)) {
            streams.set(m.streamId, []);
            if (m.contentType !== undefined) contentTypes.set(m.streamId, m.contentType);
          }
          send({ type: "stream.opened", streamId: m.streamId, committedThrough: streams.get(m.streamId)!.at(-1)?.seq ?? "0", retainedFrom: streams.get(m.streamId)!.length ? "1" : null, ...(contentTypes.has(m.streamId) ? { contentType: contentTypes.get(m.streamId) } : {}) });
          break;
        case "stream.append": {
          appends.push(m.events);
          const events = streams.get(m.streamId)!;
          for (const event of m.events) {
            const existing = events.find((row) => row.seq === event.seq);
            if (existing && existing.payload !== event.payload) {
              send({ type: "error", code: "event_conflict", message: "conflict", retryable: false });
              return;
            }
            if (!existing) events.push(event);
          }
          if (drop) { drop = false; ws.terminate(); return; }
          send({ type: "stream.appended", streamId: m.streamId, committedThrough: events.at(-1)!.seq });
          break;
        }
        case "subscription.ack": send({ type: "subscription.acked", subscriptionId: m.subscriptionId, through: m.through }); break;
      }
    });
  });
  const address = wss.address();
  if (typeof address === "string" || !address) throw new Error("address missing");
  return { url: `ws://127.0.0.1:${address.port}`, streams, appends, socket: () => latest! };
}
function client(url: string) {
  const client = new SyncClient({ url, token: "test-only", requestTimeoutMs: 1_000 });
  cleanup.push(() => client.close());
  return client;
}

describe("reliable file source", () => {
  it("persists original payloads and sequence across reopen; local append is atomic", async () => {
    const file = await sourceFile();
    let log = await FileEventSource.create(file);
    cleanup.push(() => log.close());
    await log.openStream("s", "application/test");
    const payload = '{"b": 2, "a": "🎉"}\n';
    await log.append("s", [payload]);
    await expect(log.append("s", ["rollback", "\ud800"])).rejects.toThrow();
    log.close();
    log = await FileEventSource.open(file);
    expect(await log.listStreams()).toEqual([{ streamId: "s", contentType: "application/test", committedThrough: "1" }]);
    expect(await log.read("s", "0", 128)).toEqual([{ seq: "1", payload }]);
    expect(await log.append("s", ["next"])).toEqual([{ seq: "2", payload: "next" }]);
    await expect(log.openStream("s", "different")).rejects.toMatchObject({ code: "content_type_conflict" });
    await expect(FileEventSource.create(file)).rejects.toThrow();
  });
  it("never creates a lost source during reopen and does not silently reset", async () => {
    const missing = await sourceFile();
    await expect(FileEventSource.open(missing)).rejects.toMatchObject({ code: "local_state_lost", message: expect.stringContaining("ENOENT"), cause: { code: "ENOENT" } });
    await expect(access(missing)).rejects.toThrow();
  });
  it("multiple handles allocate contiguous durable sequence transactionally", async () => {
    const file = await sourceFile();
    const first = await FileEventSource.create(file);
    cleanup.push(() => first.close());
    await first.openStream("s");
    const second = await FileEventSource.open(file);
    cleanup.push(() => second.close());
    await first.append("s", ["one"]);
    await second.append("s", ["two"]);
    await first.append("s", ["three"]);
    expect((await second.read("s", "0", 128)).map((event) => event.seq)).toEqual(["1", "2", "3"]);
  });
});

describe("generic Node WebSocket connector", () => {
  it("rejects lost local contentType metadata even when stream identity and history still match", async () => {
    const remote = await server();
    const node = client(remote.url);
    await node.connect();
    const events = [{ seq: "1", payload: "same immutable content" }];
    const typed = source(events);
    typed.listStreams = async () => [{ streamId: "s", committedThrough: "1", contentType: "application/test" }];
    await node.synchronize(typed);
    await expect(node.synchronize(source(events))).rejects.toMatchObject({ code: "content_type_conflict" });
    expect(remote.appends).toHaveLength(1);
  });
  it.each(["", "x".repeat(257), "\ud800"])("validates all source stream metadata before creating any remote stream (%j)", async (contentType) => {
    const remote = await server();
    const node = client(remote.url);
    await node.connect();
    const local = source([]);
    local.listStreams = async () => [
      { streamId: "valid-first", committedThrough: "0" },
      { streamId: "invalid-second", committedThrough: "0", contentType },
    ];
    await expect(node.synchronize(local)).rejects.toMatchObject({ code: "source_history_unavailable" });
    expect(remote.streams.size).toBe(0);
  });
  it.each(["list", "read"] as const)("preserves the original cause and diagnostic message when source %s fails", async (operation) => {
    const remote = await server();
    const node = client(remote.url);
    await node.connect();
    const local = source([{ seq: "1", payload: "one" }]);
    const cause = new Error("injected EACCES while reading durable source");
    if (operation === "list") local.listStreams = async () => { throw cause; };
    else local.read = async () => { throw cause; };
    await expect(node.synchronize(local)).rejects.toMatchObject({
      code: "source_history_unavailable", message: expect.stringContaining(cause.message), cause,
    });
  });
  it("replays exact persisted content after an append ACK is lost", async () => {
    const remote = await server(true);
    const local = source([{ seq: "1", payload: '{"x": 1}' }, { seq: "2", payload: "original\n" }]);
    const first = client(remote.url);
    await first.connect();
    await expect(first.synchronize(local)).rejects.toThrow("disconnected");
    const recovered = client(remote.url);
    await recovered.connect();
    await recovered.synchronize(local);
    expect(remote.streams.get("s")).toHaveLength(2);
    expect(remote.appends).toEqual([remote.streams.get("s"), remote.streams.get("s")]);
  });
  it("halts on remote-ahead local state loss, missing streams, source holes, and conflicts", async () => {
    const remote = await server();
    const node = client(remote.url);
    await node.connect();
    await node.synchronize(source([{ seq: "1", payload: "one" }, { seq: "2", payload: "two" }]));
    await expect(node.synchronize(source([{ seq: "1", payload: "one" }]))).rejects.toMatchObject({ code: "local_state_lost" });
    await expect(node.synchronize({ ...source([]), listStreams: async () => [] })).rejects.toMatchObject({ code: "local_state_lost" });
    await expect(node.synchronize(source([{ seq: "1", payload: "one" }, { seq: "3", payload: "hole" }]))).rejects.toMatchObject({ code: "source_history_unavailable" });
    await expect(node.synchronize(source([{ seq: "1", payload: "changed" }, { seq: "2", payload: "two" }]))).rejects.toMatchObject({ code: "event_conflict" });
    expect(remote.streams.get("s")![0].payload).toBe("one");
  });
  it("splits durable replay by encoded batch bytes, not just event count", async () => {
    const remote = await server();
    const node = client(remote.url);
    await node.connect();
    await node.synchronize(source(Array.from({ length: 5 }, (_, i) => ({ seq: `${i + 1}`, payload: "x".repeat(LIMITS.payloadBytes) }))));
    expect(remote.appends).toHaveLength(5);
  });
  it("coalesces short source pages into bounded append batches", async () => {
    const remote = await server();
    const node = client(remote.url);
    await node.connect();
    const events = Array.from({ length: 129 }, (_, i) => ({ seq: `${i + 1}`, payload: "x" }));
    const local = source(events);
    local.read = async (_stream, after) => events.filter((event) => BigInt(event.seq) > BigInt(after)).slice(0, 1);
    await node.synchronize(local);
    expect(remote.appends.map((batch) => batch.length)).toEqual([128, 1]);
  });
  it("delivers without auto-ACK and lets the consumer ACK only after durable processing", async () => {
    const remote = await server();
    let resolveDelivery!: () => void;
    const delivered = new Promise<void>((resolve) => { resolveDelivery = resolve; });
    const consumer = new SyncClient({ url: remote.url, token: "test", role: "reader", onDelivery: () => resolveDelivery() });
    cleanup.push(() => consumer.close());
    await consumer.connect();
    remote.socket().send(JSON.stringify({ type: "subscription.events", subscriptionId: "sub", streamId: "s", events: [{ seq: "1", payload: "opaque" }], caughtUpThrough: "1" }));
    await delivered;
    expect(await consumer.request({ type: "subscription.ack", subscriptionId: "sub", through: "1" })).toMatchObject({ type: "subscription.acked", through: "1" });
  });
  it("stops unauthorized upgrades rather than endlessly reconnecting", async () => {
    const http = createServer((_req, res) => { res.writeHead(401); res.end(); });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const node = client(`ws://127.0.0.1:${address.port}`);
    await expect(node.connect()).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("cancels continuous synchronization without leaving a connection/timer alive", async () => {
    const remote = await server();
    const abort = new AbortController();
    const local = source([{ seq: "1", payload: "one" }]);
    local.waitForChange = async () => { abort.abort(); };
    await runSync({ url: remote.url, token: "test" }, local, abort.signal);
    expect(remote.streams.get("s")).toEqual([{ seq: "1", payload: "one" }]);
  });
});
