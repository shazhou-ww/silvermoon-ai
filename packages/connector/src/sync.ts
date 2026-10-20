import WebSocket from "ws";
import {
  LIMITS, SYNC_VERSION, SyncError, contentTypeSchema, eventSchema, idSchema, parseClientMessage,
  seqSchema, serverMessageSchema, type ClientMessage, type EventRecord, type ServerMessage,
} from "@silvermoon-ai/sync-protocol";

export { LIMITS, SYNC_VERSION, SyncError };
export type { ClientMessage, EventRecord, ServerMessage };
export { FileEventSource } from "./sync-source.js";
export type { SourceStream } from "./sync-source.js";

export interface ReliableEventSource {
  /** Complete, stable stream identities and durable heads. Never regenerate IDs on reopen. */
  listStreams(): Promise<{ streamId: string; committedThrough: string; contentType?: string }[]>;
  /** Return the original immutable strings, without gaps, from after + 1. */
  read(streamId: string, after: string, limit: number): Promise<EventRecord[]>;
  /** Notification only: callers always re-read durable state. Must honor cancellation. */
  waitForChange(signal: AbortSignal): Promise<void>;
}
export interface SyncClientOptions {
  url: string;
  token: string;
  role?: "reader" | "writer";
  requestTimeoutMs?: number;
  onDelivery?: (message: Extract<ServerMessage, { type: "subscription.events" }>) => void | Promise<void>;
  onError?: (error: Error) => void;
}

/** One bounded connection. Deliveries are never auto-ACKed on network receipt. */
export class SyncClient {
  private socket?: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private counter = 0;
  private pending = new Map<string, {
    resolve(message: ServerMessage): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private syncing = false;
  private terminal?: Error;
  private connecting = false;
  private closed = true;
  private queuedRequests = 0;
  private requestTimes: number[] = [];
  private connectionAbort = new AbortController();
  private readonly appendInFlight = new Set<string>();

  constructor(private readonly options: SyncClientOptions) {}

  async connect(): Promise<void> {
    if (this.connecting || this.socket) throw new Error("already connected or connecting");
    this.connecting = true;
    this.terminal = undefined;
    this.closed = false;
    this.connectionAbort = new AbortController();
    this.requestTimes = [];
    try {
      const url = new URL(this.options.url);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid WebSocket URL");
      const ws = new WebSocket(url, {
        headers: { authorization: `Bearer ${this.options.token}` },
        maxPayload: LIMITS.frameBytes,
        handshakeTimeout: this.options.requestTimeoutMs ?? 10_000,
      });
      this.socket = ws;
      ws.on("message", (data, binary) => {
        try {
          if (binary) throw new SyncError("invalid_message", "binary server frame");
          const message = serverMessageSchema.parse(JSON.parse(data.toString()));
          if (message.type === "error") {
            const error = new SyncError(message.code, message.message, message.retryable);
            if (message.requestId && this.pending.has(message.requestId)) this.finish(message.requestId, undefined, error);
            else this.options.onError?.(error);
            if (["unauthorized", "unsupported_version", "stale_connection", "slow_consumer", "resubscribe_required", "quota_exceeded"].includes(message.code)) {
              this.terminal = error;
              this.disconnect(error);
            }
          } else if (message.type === "subscription.events") {
            if (!this.options.onDelivery) throw new SyncError("invalid_message", "delivery handler required");
            void Promise.resolve(this.options.onDelivery(message)).catch((error: unknown) => {
              const failure = error instanceof Error ? error : new Error("consumer delivery failed");
              this.options.onError?.(failure);
              this.disconnect(failure);
            });
          } else if ("requestId" in message) {
            this.finish(message.requestId, message);
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error("invalid server message");
          this.options.onError?.(failure);
          this.disconnect(failure);
        }
      });
      ws.on("close", () => this.disconnect(this.terminal ?? new Error("sync disconnected; resubscribe from durable cursor")));
      ws.on("error", (error) => this.disconnect(error));
      ws.on("unexpected-response", (_request, response) => {
        const error = response.statusCode === 401 || response.statusCode === 403
          ? new SyncError("unauthorized")
          : new SyncError("quota_exceeded", `upgrade rejected (${response.statusCode})`, true);
        response.resume();
        this.terminal = error;
        this.disconnect(error);
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
        ws.once("close", () => reject(new Error("closed before handshake")));
        ws.once("unexpected-response", (_request, response) => reject(
          response.statusCode === 401 || response.statusCode === 403
            ? new SyncError("unauthorized")
            : new SyncError("quota_exceeded", "upgrade rejected", true),
        ));
      });
      await this.request({ type: "hello", version: SYNC_VERSION, role: this.options.role ?? "writer" });
      this.heartbeat = setInterval(() => {
        void this.request({ type: "ping" }).catch((error: Error) => this.disconnect(error));
      }, LIMITS.leaseMs / 3);
      this.heartbeat.unref();
    } catch (error) {
      this.disconnect(error instanceof Error ? error : new Error("connection failed"));
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private finish(id: string, message?: ServerMessage, error?: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (error) pending.reject(error);
    else pending.resolve(message!);
  }

  private disconnect(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.connectionAbort.abort();
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const id of this.pending.keys()) this.finish(id, undefined, error);
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
  }

  close(): void {
    this.disconnect(new Error("sync client closed"));
  }

  async request(message: ClientRequest): Promise<ServerMessage> {
    if (this.queuedRequests >= LIMITS.inFlightRequests) throw new SyncError("quota_exceeded", "client in-flight limit", true);
    if (message.type === "stream.append" && this.appendInFlight.has(message.streamId)) throw new SyncError("quota_exceeded", "only one append per stream may be in flight", true);
    if (message.type === "stream.append") this.appendInFlight.add(message.streamId);
    this.queuedRequests++;
    try { return await this.sendRequest(message); }
    finally {
      this.queuedRequests--;
      if (message.type === "stream.append") this.appendInFlight.delete(message.streamId);
    }
  }

  private async sendRequest(message: ClientRequest): Promise<ServerMessage> {
    if (this.terminal) throw this.terminal;
    // A sliding local budget is deliberately below the server's fixed-period limit.
    // This also bounds read/request traffic, not just append/subscription windows.
    while (true) {
      this.requestTimes = this.requestTimes.filter((at) => Date.now() - at < LIMITS.authCheckMs);
      if (this.requestTimes.length < LIMITS.requestsPerPeriod / 2) break;
      const signal = this.connectionAbort.signal;
      if (signal.aborted) throw new Error("sync disconnected");
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error("sync disconnected")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(1, this.requestTimes[0] + LIMITS.authCheckMs - Date.now()));
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("not connected");
    if (this.pending.size >= 16 || socket.bufferedAmount > LIMITS.frameBytes) throw new SyncError("quota_exceeded", "client in-flight limit", true);
    const requestId = `r${++this.counter}`;
    const text = JSON.stringify({ ...message, requestId });
    parseClientMessage(text);
    this.requestTimes.push(Date.now());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("sync request timed out; durable append outcome unknown");
        this.finish(requestId, undefined, error);
        this.disconnect(error);
      }, this.options.requestTimeoutMs ?? 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      socket.send(text, (error) => { if (error) this.finish(requestId, undefined, error); });
    });
  }

  /**
   * Replays and verifies all local history, including the remote committed prefix.
   * No remote head is trusted as permission to skip locally unknown content.
   */
  async synchronize(source: ReliableEventSource): Promise<void> {
    if (this.syncing) throw new Error("synchronize already in flight");
    this.syncing = true;
    try {
      const streams = await readSource(() => source.listStreams());
      if (streams.length > LIMITS.streams || new Set(streams.map((s) => s.streamId)).size !== streams.length) throw new SyncError("source_history_unavailable");
      for (const stream of streams) {
        if (!idSchema.safeParse(stream.streamId).success
          || !seqSchema.safeParse(stream.committedThrough).success
          || (stream.contentType !== undefined && !contentTypeSchema.safeParse(stream.contentType).success)) {
          throw new SyncError("source_history_unavailable", "invalid source stream identity, head, or contentType");
        }
      }
      const remote = await this.request({ type: "stream.list", limit: LIMITS.streams });
      if (remote.type !== "stream.listed") throw new SyncError("invalid_message");
      if (remote.next || remote.streams.some((row) => !streams.some((local) => local.streamId === row.streamId))) {
        throw new SyncError("local_state_lost", "remote streams missing from local durable source");
      }
      for (const stream of streams) {
        const opened = await this.request({ type: "stream.open", streamId: stream.streamId, contentType: stream.contentType });
        if (opened.type !== "stream.opened") throw new SyncError("invalid_message");
        if (opened.contentType !== stream.contentType) throw new SyncError("content_type_conflict", "local and remote stream contentType differ, including missing metadata");
        if (BigInt(opened.committedThrough) > BigInt(stream.committedThrough)) throw new SyncError("local_state_lost", "remote head exceeds durable local source");
        let after = "0";
        let batch: EventRecord[] = [];
        while (BigInt(after) < BigInt(stream.committedThrough)) {
          const events = await readSource(() => source.read(stream.streamId, after, LIMITS.batchEvents));
          if (!events.length || events.length > LIMITS.batchEvents) throw new SyncError("source_history_unavailable", "local source missing history");
          let expected = BigInt(after) + 1n;
          for (const event of events) {
            if (!eventSchema.safeParse(event).success || BigInt(event.seq) !== expected++) throw new SyncError("source_history_unavailable", "invalid or discontinuous source");
            if (BigInt(event.seq) > BigInt(stream.committedThrough)) break;
            const candidate = [...batch, event];
            if (batch.length >= LIMITS.batchEvents || new TextEncoder().encode(JSON.stringify(candidate)).byteLength > LIMITS.batchBytes) {
              await this.append(stream.streamId, batch);
              batch = [];
            }
            batch.push(event);
            after = event.seq;
          }
        }
        if (batch.length) await this.append(stream.streamId, batch);
      }
    } finally { this.syncing = false; }
  }

  private async append(streamId: string, events: EventRecord[]): Promise<void> {
    const reply = await this.request({ type: "stream.append", streamId, events });
    if (reply.type !== "stream.appended" || BigInt(reply.committedThrough) < BigInt(events.at(-1)!.seq)) throw new SyncError("invalid_message", "invalid durable append ACK");
  }
}

type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
export type ClientRequest = WithoutRequest<ClientMessage>;

async function readSource<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof SyncError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new SyncError("source_history_unavailable", `cannot read durable local source: ${detail}`, false, { cause: error });
  }
}

/** Transport retries are at-least-once; conflicts/source regressions stop the loop. */
export async function runSync(
  options: SyncClientOptions,
  source: ReliableEventSource,
  signal: AbortSignal,
): Promise<void> {
  let attempts = 0;
  while (!signal.aborted) {
    const client = new SyncClient(options);
    const stop = () => client.close();
    signal.addEventListener("abort", stop, { once: true });
    try {
      await client.connect();
      while (!signal.aborted) {
        await client.synchronize(source);
        attempts = 0;
        const wake = new AbortController();
        const abort = () => wake.abort();
        signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, 1_000);
        try { await source.waitForChange(wake.signal); }
        finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof SyncError && !error.retryable) throw error;
      options.onError?.(error instanceof Error ? error : new Error("sync failed"));
    } finally {
      signal.removeEventListener("abort", stop);
      client.close();
    }
    if (!signal.aborted) {
      const delay = Math.min(30_000, 250 * 2 ** Math.min(attempts++, 7)) * (0.5 + Math.random() / 2);
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, delay);
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }
}
