import type { DatabaseSync } from "node:sqlite";
import { open, unlink } from "node:fs/promises";
import {
  canonicalPayload, DUPLEX_LIMITS as LIMITS, DuplexError, messageIdSchema,
  pageSchema, submissionSchema, type Message, type Submission,
} from "@silvermoon-ai/sync-protocol/duplex";

export { DuplexError };
export type { Message, Submission };
export interface DeviceConnectorOptions {
  relayUrl: string;
  accountId: string;
  deviceId: string;
  statePath: string;
  token: () => string | Promise<string>;
  fetch?: typeof fetch;
  attempts?: number;
  timeoutMs?: number;
}
type Metadata = {
  version: number; relay: string; account: string; device: string;
  owner: string; expires: number; cursor: string; generation: string;
};
type InboxRow = { id: string; message: string; acked: number };

/** Explicit lifecycle; construction/import does not open files, connect or own the process. */
export class DeviceConnector {
  private db?: DatabaseSync;
  private owner = "";
  private generation?: string;
  private fenced = false;
  private startupFailure?: DuplexError;
  private stopEpoch = 0;
  private active?: AbortController;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly relay: string;
  private readonly attempts: number;
  private readonly timeout: number;
  constructor(private readonly options: DeviceConnectorOptions) {
    this.options = { ...options };
    const url = new URL(options.relayUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new DuplexError("invalid_relay");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new DuplexError("invalid_relay");
    if (!options.deviceId || !options.accountId) throw new DuplexError("invalid_identity");
    this.relay = url.origin;
    this.attempts = options.attempts ?? 3;
    this.timeout = options.timeoutMs ?? 25_000;
    if (!Number.isInteger(this.attempts) || this.attempts < 1 || this.attempts > 3
      || !Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 30_000) throw new DuplexError("invalid_limits");
  }

  initialize(options: { create?: boolean; takeover?: boolean } = {}): Promise<void> {
    return this.exclusive(() => this.initializeState(options));
  }

  private async initializeState(options: { create?: boolean; takeover?: boolean }): Promise<void> {
    if (this.startupFailure) throw this.startupFailure;
    if (this.db) throw new DuplexError("already_initialized");
    let created = false;
    let db: DatabaseSync | undefined;
    try {
      const file = await open(this.options.statePath, options.create ? "wx" : "r+");
      await file.close();
      created = options.create === true;
      const { DatabaseSync } = await import("node:sqlite");
      db = new DatabaseSync(this.options.statePath);
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;");
      if (created) {
        db.exec(`
          CREATE TABLE metadata (version INTEGER NOT NULL,relay TEXT NOT NULL,account TEXT NOT NULL,device TEXT NOT NULL,
            owner TEXT NOT NULL,expires INTEGER NOT NULL,cursor TEXT NOT NULL,generation TEXT NOT NULL);
          CREATE TABLE outbox (key TEXT PRIMARY KEY,payload TEXT NOT NULL,remote_id TEXT);
          CREATE TABLE inbox (id TEXT PRIMARY KEY,message TEXT NOT NULL,acked INTEGER NOT NULL DEFAULT 0);
        `);
        db.prepare("INSERT INTO metadata VALUES (2,?,?,?,'',0,'0','0')")
          .run(this.relay, this.options.accountId, this.options.deviceId);
      }
      const rows = db.prepare("SELECT * FROM metadata").all() as unknown as Metadata[];
      const meta = rows[0];
      if (rows.length !== 1 || meta.version !== 2 || meta.relay !== this.relay || meta.account !== this.options.accountId
        || meta.device !== this.options.deviceId || !messageIdSchema.safeParse(meta.cursor).success
        || !messageIdSchema.safeParse(meta.generation).success) throw new DuplexError("local_state_mismatch");
      db.prepare("SELECT key,payload,remote_id FROM outbox LIMIT 0").all();
      db.prepare("SELECT id,message,acked FROM inbox LIMIT 0").all();
      const owner = crypto.randomUUID();
      const claim = db.prepare("UPDATE metadata SET owner=?,expires=? WHERE owner='' OR expires<=? OR ?=1")
        .run(owner, Date.now() + LIMITS.leaseMs, Date.now(), Number(options.takeover === true));
      if (claim.changes !== 1) throw new DuplexError("local_lease_conflict");
      this.owner = owner;
      this.db = db;
      this.fenced = false;
    } catch (error) {
      db?.close();
      if (created) await unlink(this.options.statePath).catch(() => {});
      if (error instanceof DuplexError) throw error;
      throw new DuplexError("local_state_unavailable");
    }
  }

  private local<T>(operation: (db: DatabaseSync) => T): T {
    if (this.startupFailure) throw this.startupFailure;
    const db = this.db;
    if (!db) throw new DuplexError("not_initialized");
    if (this.fenced) throw new DuplexError("stale_generation");
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT owner FROM metadata").get();
      if (row?.owner !== this.owner) throw new DuplexError("local_lease_conflict");
      db.prepare("UPDATE metadata SET expires=?").run(Date.now() + LIMITS.leaseMs);
      const result = operation(db);
      db.exec("COMMIT");
      return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const epoch = this.stopEpoch;
    const result = this.chain.then(() => {
      if (epoch !== this.stopEpoch) throw new DuplexError("stopped");
      return operation();
    });
    this.chain = result.catch(() => {});
    return result;
  }

  private capacity(db: DatabaseSync, extraBytes: number): void {
    const row = db.prepare(`SELECT (SELECT COUNT(*) FROM outbox)+(SELECT COUNT(*) FROM inbox) AS count,
      COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM outbox),0)
      +COALESCE((SELECT SUM(length(CAST(message AS BLOB))) FROM inbox),0) AS bytes`).get()!;
    if (Number(row.count) >= LIMITS.localMessages || Number(row.bytes) + extraBytes > LIMITS.localBytes) throw new DuplexError("local_backpressure");
  }

  enqueue(payload: Submission["payload"], key: string = crypto.randomUUID()): { status: "queued"; key: string; remoteId: string | null } {
    const parsed = submissionSchema.safeParse({ key, payload });
    if (!parsed.success) throw new DuplexError("invalid_request");
    const text = canonicalPayload(parsed.data.payload);
    return this.local(db => {
      const old = db.prepare("SELECT payload,remote_id FROM outbox WHERE key=?").get(key);
      if (old && old.payload !== text) throw new DuplexError("idempotency_conflict");
      if (!old) {
        this.capacity(db, new TextEncoder().encode(text).byteLength);
        db.prepare("INSERT INTO outbox VALUES (?,?,NULL)").run(key, text);
      }
      return { status: "queued", key, remoteId: old?.remote_id as string | null ?? null };
    });
  }

  private async request(path: string, method: "GET" | "POST", body?: object, leased = true): Promise<unknown> {
    const epoch = this.stopEpoch;
    this.local(() => {});
    if (leased && !this.generation) throw new DuplexError("not_started");
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (epoch !== this.stopEpoch) throw new DuplexError("stopped");
      const controller = new AbortController();
      this.active = controller;
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const token = await new Promise<string>((resolve, reject) => {
          const abort = () => reject(new DuplexError("transport_unavailable", true));
          controller.signal.addEventListener("abort", abort, { once: true });
          Promise.resolve().then(() => this.options.token()).then(resolve, reject)
            .finally(() => controller.signal.removeEventListener("abort", abort));
        });
        if (controller.signal.aborted) throw new DuplexError("transport_unavailable", true);
        const response = await (this.options.fetch ?? fetch)(`${this.relay}/v2/devices/${encodeURIComponent(this.options.deviceId)}/${path}`, {
          method, signal: controller.signal, redirect: "error",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
            "x-device-owner": this.owner, "x-device-generation": this.generation ?? "0" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        // Relay pages are bounded. Do not trust an arbitrary proxy's unbounded body.
        const reader = response.body?.getReader();
        let text = "", bytes = 0;
        const decoder = new TextDecoder();
        try {
          if (!reader) throw new DuplexError("invalid_response");
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            bytes += item.value.byteLength;
            if (bytes > LIMITS.page * (LIMITS.payloadBytes + 2048)) throw new DuplexError("invalid_response");
            text += decoder.decode(item.value, { stream: true });
          }
          text += decoder.decode();
        } finally { await reader?.cancel(); }
        const value: unknown = JSON.parse(text);
        if (!response.ok) {
          const failure = value as { error?: string; retryable?: boolean; retained_after?: string };
          const code = typeof failure?.error === "string" ? failure.error : "invalid_response";
          if (code === "stale_generation") this.fenced = true;
          throw new DuplexError(code, failure?.retryable === true, failure?.retained_after);
        }
        if (epoch !== this.stopEpoch) throw new DuplexError("stopped");
        return value;
      } catch (error) {
        if (controller.signal.reason === "stopped") throw new DuplexError("stopped");
        const failure = error instanceof DuplexError ? error : new DuplexError("transport_unavailable", true);
        if (!failure.retryable || attempt + 1 === this.attempts) throw failure;
      } finally {
        clearTimeout(timer);
        if (this.active === controller) this.active = undefined;
      }
      await this.retryDelay(100 * 2 ** attempt, epoch);
      this.local(() => {});
    }
    throw new DuplexError("transport_unavailable", true);
  }

  private async retryDelay(ms: number, epoch: number): Promise<void> {
    if (epoch !== this.stopEpoch) throw new DuplexError("stopped");
    const controller = new AbortController();
    this.active = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(resolve, ms);
        cancel = () => reject(new DuplexError("stopped"));
        controller.signal.addEventListener("abort", cancel, { once: true });
      });
    } finally {
      clearTimeout(timer);
      if (cancel) controller.signal.removeEventListener("abort", cancel);
      if (this.active === controller) this.active = undefined;
    }
  }

  start(options: { takeover?: boolean } = {}): Promise<{ generation: string; expires: number }> {
    return this.exclusive(async () => {
      const value = await this.request("lease", "POST", { action: "acquire", owner: this.owner, takeover: options.takeover === true }, false) as { generation: string; expires: number; ack: string };
      if (!messageIdSchema.safeParse(value.generation).success || !messageIdSchema.safeParse(value.ack).success
        || !Number.isSafeInteger(value.expires)) throw new DuplexError("invalid_response");
      try {
        this.local(db => {
          const cursor = db.prepare("SELECT cursor FROM metadata").get()!.cursor as string;
          if (BigInt(value.ack) > BigInt(cursor)) throw new DuplexError("local_state_lost");
          db.prepare("UPDATE metadata SET generation=?").run(value.generation);
        });
      } catch (error) {
        this.generation = undefined;
        if (error instanceof DuplexError && error.code === "local_state_lost") {
          this.startupFailure = error;
          this.fenced = true;
        }
        throw error;
      }
      this.generation = value.generation;
      return { generation: value.generation, expires: value.expires };
    });
  }

  renew(): Promise<void> {
    return this.exclusive(async () => { await this.request("lease", "POST", { action: "renew", owner: this.owner }); });
  }

  flush(limit: number = LIMITS.page): Promise<{ status: "accepted"; key: string; id: string }[]> {
    return this.exclusive(async () => {
      if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.page) throw new DuplexError("invalid_limits");
      const rows = this.local(db => db.prepare("SELECT key,payload FROM outbox WHERE remote_id IS NULL ORDER BY rowid LIMIT ?").all(limit));
      const accepted: { status: "accepted"; key: string; id: string }[] = [];
      for (const row of rows) {
        const value = await this.request("events", "POST", { key: row.key, payload: JSON.parse(row.payload as string) }) as { status: string; id: string };
        if (value.status !== "accepted" || !messageIdSchema.safeParse(value.id).success) throw new DuplexError("invalid_response");
        this.local(db => { db.prepare("UPDATE outbox SET remote_id=? WHERE key=?").run(value.id, row.key as string); });
        accepted.push({ status: "accepted", key: row.key as string, id: value.id });
      }
      return accepted;
    });
  }

  /** Returns durable, unacknowledged work; invocation never acknowledges it. */
  pending(): Message[] {
    return this.local(db => (db.prepare("SELECT id,message,acked FROM inbox WHERE acked=0 ORDER BY length(id),id LIMIT ?")
      .all(LIMITS.page) as unknown as InboxRow[]).map(row => JSON.parse(row.message) as Message));
  }

  receive(waitMs = 0): Promise<Message[]> {
    return this.exclusive(async () => {
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > LIMITS.waitMs) throw new DuplexError("invalid_limits");
      const pending = this.pending();
      if (pending.length) {
        // Revalidate remote fencing before handing existing inbox work to the host.
        await this.request("lease", "POST", { action: "renew", owner: this.owner });
        return pending;
      }
      const cursor = this.local(db => db.prepare("SELECT cursor FROM metadata").get()!.cursor as string);
      const parsed = pageSchema.safeParse(await this.request(`regulations?after=${cursor}&wait=${waitMs}`, "GET"));
      if (!parsed.success) throw new DuplexError("invalid_response");
      const page = parsed.data;
      let last = BigInt(cursor);
      for (const message of page.messages) {
        if (message.account_id !== this.options.accountId || message.device_id !== this.options.deviceId
          || message.is_upstream || BigInt(message.id) <= last) throw new DuplexError("invalid_response");
        last = BigInt(message.id);
      }
      if (page.next !== (page.messages.at(-1)?.id ?? cursor)) throw new DuplexError("invalid_response");
      this.local(db => {
        for (const message of page.messages) {
          const text = JSON.stringify(message);
          this.capacity(db, new TextEncoder().encode(text).byteLength);
          db.prepare("INSERT INTO inbox(id,message) VALUES (?,?)").run(message.id, text);
        }
        db.prepare("UPDATE metadata SET cursor=?").run(page.next);
      });
      return this.pending();
    });
  }

  /** The host calls this ONLY after its own durable receipt transaction commits. */
  acknowledge(id: string): Promise<void> {
    return this.exclusive(async () => {
      if (!messageIdSchema.safeParse(id).success) throw new DuplexError("invalid_cursor");
      this.local(db => {
        const row = db.prepare("SELECT acked FROM inbox WHERE id=?").get(id);
        if (!row) throw new DuplexError("unknown_message");
        const oldest = db.prepare("SELECT id FROM inbox WHERE acked=0 ORDER BY length(id),id LIMIT 1").get()?.id;
        if (!row.acked && oldest !== id) throw new DuplexError("ack_out_of_order");
      });
      await this.request("ack", "POST", { id });
      this.local(db => { db.prepare("UPDATE inbox SET acked=1 WHERE id=?").run(id); });
    });
  }

  state(): { accountId: string; deviceId: string; cursor: string; queued: number; accepted: number; pending: number; started: boolean; fenced: boolean } {
    if (!this.db) throw new DuplexError("not_initialized");
    const meta = this.db.prepare("SELECT * FROM metadata").get() as unknown as Metadata;
    return { accountId: meta.account, deviceId: meta.device, cursor: meta.cursor,
      queued: Number(this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE remote_id IS NULL").get()!.n),
      accepted: Number(this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE remote_id IS NOT NULL").get()!.n),
      pending: Number(this.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE acked=0").get()!.n),
      started: this.generation !== undefined && !this.fenced, fenced: this.fenced };
  }

  async stop(): Promise<void> {
    this.stopEpoch++;
    this.active?.abort("stopped");
    return this.exclusive(async () => {
      try {
        if (this.generation && !this.fenced) await this.request("lease", "POST", { action: "release", owner: this.owner });
      } finally {
        this.generation = undefined;
        if (this.db) {
          this.db.prepare("UPDATE metadata SET owner='',expires=0 WHERE owner=?").run(this.owner);
          this.db.close();
          this.db = undefined;
        }
      }
    });
  }
}
