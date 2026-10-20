import { DurableObject } from "cloudflare:workers";
import {
  canonicalPayload, DUPLEX_LIMITS as LIMITS, DuplexError, MAX_MESSAGE_ID, messageIdSchema,
  submissionSchema, type Message, type MessagePage,
} from "@silvermoon-ai/sync-protocol/duplex";

export type MessagePrincipal =
  | { account: string; role: "client"; session: string }
  | { account: string; role: "device"; device: string; token: string };
type Lease = { generation: string; owner: string; expires: number; ack: string };
type Row = { id: string; account_id: string; device_id: string; is_upstream: number; payload: string };
export type Result<T> = { value: T } | { error: string; retryable: boolean; retained_after?: string };

// One account is the ordering/authorization atom. No v1 logs are imported.
export class AccountMessages extends DurableObject<Env> {
  private readonly subscriptions = new Map<string, number>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (singleton INTEGER PRIMARY KEY CHECK(singleton=1), account TEXT, retained_after TEXT NOT NULL);
      INSERT OR IGNORE INTO metadata VALUES (1,NULL,'0');
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, device_id TEXT NOT NULL,
        is_upstream INTEGER NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS account_upstream ON messages(is_upstream,id);
      CREATE INDEX IF NOT EXISTS device_downstream ON messages(device_id,is_upstream,id);
      CREATE TABLE IF NOT EXISTS submissions (
        key TEXT PRIMARY KEY, producer TEXT NOT NULL, device TEXT NOT NULL, upstream INTEGER NOT NULL,
        payload TEXT NOT NULL, message_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (
        device TEXT PRIMARY KEY, generation TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL, ack TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS write_grants (session TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS rate_limits (principal TEXT PRIMARY KEY, period INTEGER NOT NULL, requests INTEGER NOT NULL);
    `);
  }

  private principalKey(p: MessagePrincipal): string {
    return p.role === "client" ? `client:${p.session}` : `device:${p.device}`;
  }

  private async authorized(p: MessagePrincipal, target?: string): Promise<void> {
    const account = this.ctx.storage.sql.exec<{ account: string | null }>("SELECT account FROM metadata").one().account;
    if (account !== null && account !== p.account) throw new DuplexError("forbidden");
    const auth = p.role === "client"
      ? this.env.DB.prepare(`SELECT s.id FROM browser_sessions s JOIN users u ON u.id=s.user_id
          WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday('now')`)
        .bind(p.session, p.account)
      : this.env.DB.prepare(`SELECT t.id FROM connection_tokens t JOIN users u ON u.id=t.user_id
          JOIN devices d ON d.user_id=t.user_id AND d.id=t.device_id
          WHERE t.id=? AND t.user_id=? AND t.device_id=? AND t.scope='daemon:connect'
          AND t.revoked_at IS NULL AND d.removed_at IS NULL
          AND (t.expires_at IS NULL OR julianday(t.expires_at)>julianday('now'))`)
        .bind(p.token, p.account, p.device);
    if (!await auth.first()) throw new DuplexError("unauthorized");
    if (target && !await this.env.DB.prepare("SELECT id FROM devices WHERE user_id=? AND id=? AND removed_at IS NULL")
      .bind(p.account, target).first()) throw new DuplexError("device_not_found");
    const bound = this.ctx.storage.sql.exec<{ account: string | null }>("SELECT account FROM metadata").one().account;
    if (bound !== null && bound !== p.account) throw new DuplexError("forbidden");
    this.ctx.storage.sql.exec("UPDATE metadata SET account=? WHERE account IS NULL", p.account);
  }

  private rate(p: MessagePrincipal): void {
    const key = this.principalKey(p), period = Math.floor(Date.now() / 60_000);
    const row = this.ctx.storage.sql.exec<{ period: number; requests: number }>(
      "SELECT period,requests FROM rate_limits WHERE principal=?", key,
    ).toArray()[0];
    if (row?.period === period && row.requests >= LIMITS.requestsPerMinute) throw new DuplexError("rate_limited", true);
    this.ctx.storage.sql.exec(`INSERT INTO rate_limits VALUES (?,?,1)
      ON CONFLICT(principal) DO UPDATE SET period=excluded.period,
      requests=CASE WHEN period=excluded.period THEN requests+1 ELSE 1 END`, key, period);
    this.ctx.storage.sql.exec("DELETE FROM rate_limits WHERE period<?", period - 1);
  }

  private lease(p: MessagePrincipal, generation: string, owner: string): Lease {
    if (p.role !== "device") throw new DuplexError("forbidden");
    const lease = this.ctx.storage.sql.exec<Lease>("SELECT generation,owner,expires,ack FROM leases WHERE device=?", p.device).toArray()[0];
    if (!lease || lease.generation !== generation || lease.owner !== owner || lease.expires <= Date.now()) {
      throw new DuplexError("stale_generation");
    }
    return lease;
  }

  private async result<T>(operation: string, execute: () => Promise<T>): Promise<Result<T>> {
    try { return { value: await execute() }; }
    catch (error) {
      if (error instanceof DuplexError) return {
        error: error.code, retryable: error.retryable,
        ...(error.retainedAfter === undefined ? {} : { retained_after: error.retainedAfter }),
      };
      console.error(JSON.stringify({
        event: "account_messages.failed", operation, object_id: this.ctx.id.toString(),
        failure: error instanceof Error ? "unexpected_exception" : "unexpected_value",
      }));
      return { error: "relay_unavailable", retryable: true };
    }
  }

  async grant(p: MessagePrincipal, enabled: boolean): Promise<Result<{ enabled: boolean }>> {
    return this.result("grant", async () => {
      await this.authorized(p);
      this.rate(p);
      if (p.role !== "client") throw new DuplexError("forbidden");
      if (enabled) this.ctx.storage.sql.exec("INSERT OR IGNORE INTO write_grants VALUES (?)", p.session);
      else this.ctx.storage.sql.exec("DELETE FROM write_grants WHERE session=?", p.session);
      return { enabled };
    });
  }

  async ownership(p: MessagePrincipal, action: "acquire" | "renew" | "release", owner: string, generation = "0", takeover = false): Promise<Result<Lease>> {
    return this.result("ownership", async () => {
      await this.authorized(p);
      this.rate(p);
      if (p.role !== "device" || !/^[A-Za-z0-9_-]{16,128}$/u.test(owner)) throw new DuplexError("invalid_request");
      return this.ctx.storage.transactionSync(() => {
        const old = this.ctx.storage.sql.exec<Lease>("SELECT generation,owner,expires,ack FROM leases WHERE device=?", p.device).toArray()[0];
        if (action !== "acquire") this.lease(p, generation, owner);
        else if (old && old.owner !== owner && old.expires > Date.now() && !takeover) throw new DuplexError("lease_conflict", true);
        const next = action === "acquire" && (!old || old.owner !== owner || old.expires <= Date.now())
          ? (BigInt(old?.generation ?? "0") + 1n).toString() : old!.generation;
        const lease = { generation: next, owner, expires: action === "release" ? 0 : Date.now() + LIMITS.leaseMs, ack: old?.ack ?? "0" };
        this.ctx.storage.sql.exec(`INSERT INTO leases VALUES (?,?,?,?,?)
          ON CONFLICT(device) DO UPDATE SET generation=excluded.generation,owner=excluded.owner,expires=excluded.expires`,
        p.device, lease.generation, owner, lease.expires, lease.ack);
        return lease;
      });
    });
  }

  async append(p: MessagePrincipal, device: string, input: unknown, generation = "0", owner = ""): Promise<Result<{ status: "accepted"; id: string }>> {
    return this.result("append", async () => {
      const parsed = submissionSchema.safeParse(input);
      if (!parsed.success) throw new DuplexError("invalid_request");
      const payload = canonicalPayload(parsed.data.payload);
      await this.authorized(p, device);
      this.rate(p);
      const upstream = p.role === "device";
      if (upstream && p.device !== device) throw new DuplexError("forbidden");
      return this.ctx.storage.transactionSync(() => {
        if (upstream) this.lease(p, generation, owner);
        else if (p.role !== "client" || !this.ctx.storage.sql.exec("SELECT session FROM write_grants WHERE session=?", p.session).toArray().length) {
          throw new DuplexError("write_permission_required");
        }
        const producer = upstream ? `device:${device}` : `account:${p.account}`;
        const old = this.ctx.storage.sql.exec<{ producer: string; device: string; upstream: number; payload: string; message_id: string }>(
          "SELECT * FROM submissions WHERE key=?", parsed.data.key,
        ).toArray()[0];
        if (old) {
          if (old.producer !== producer || old.device !== device || old.upstream !== Number(upstream) || old.payload !== payload) throw new DuplexError("idempotency_conflict");
          return { status: "accepted" as const, id: old.message_id };
        }
        const usage = this.ctx.storage.sql.exec<{ count: number; bytes: number }>(
          "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM messages",
        ).one();
        const deviceUsage = this.ctx.storage.sql.exec<{ count: number; bytes: number }>(
          "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM messages WHERE device_id=?", device,
        ).one();
        const bytes = new TextEncoder().encode(payload).byteLength;
        if (usage.count >= LIMITS.accountMessages || usage.bytes + bytes > LIMITS.accountBytes
          || deviceUsage.count >= LIMITS.deviceMessages || deviceUsage.bytes + bytes > LIMITS.deviceBytes) throw new DuplexError("quota_exceeded");
        const head = this.ctx.storage.sql.exec<{ head: string }>(
          "SELECT COALESCE((SELECT CAST(seq AS TEXT) FROM sqlite_sequence WHERE name='messages'),'0') AS head",
        ).one().head;
        if (BigInt(head) >= MAX_MESSAGE_ID) throw new DuplexError("quota_exceeded");
        this.ctx.storage.sql.exec("INSERT INTO messages(account_id,device_id,is_upstream,payload,bytes) VALUES (?,?,?,?,?)",
          p.account, device, Number(upstream), payload, bytes);
        const id = this.ctx.storage.sql.exec<{ id: string }>("SELECT CAST(last_insert_rowid() AS TEXT) AS id").one().id;
        this.ctx.storage.sql.exec("INSERT INTO submissions VALUES (?,?,?,?,?,?)", parsed.data.key, producer, device, Number(upstream), payload, id);
        return { status: "accepted" as const, id };
      });
    });
  }

  private page(p: MessagePrincipal, after: string, generation: string, owner: string, target?: string): MessagePage {
    if (!messageIdSchema.safeParse(after).success) throw new DuplexError("invalid_cursor");
    if (p.role === "device") this.lease(p, generation, owner);
    const floor = this.ctx.storage.sql.exec<{ retained_after: string }>("SELECT retained_after FROM metadata").one().retained_after;
    if (BigInt(after) < BigInt(floor)) throw new DuplexError("cursor_expired", false, floor);
    const head = this.ctx.storage.sql.exec<{ head: string }>(
      "SELECT COALESCE((SELECT CAST(seq AS TEXT) FROM sqlite_sequence WHERE name='messages'),'0') AS head",
    ).one().head;
    if (BigInt(after) > BigInt(head) && BigInt(after) > BigInt(floor)) throw new DuplexError("cursor_ahead");
    const rows = target
      ? this.ctx.storage.sql.exec<Row>(`SELECT CAST(id AS TEXT) AS id,account_id,device_id,is_upstream,payload FROM messages
          WHERE device_id=? AND id>CAST(? AS INTEGER) ORDER BY messages.id LIMIT ?`, target, after, LIMITS.page).toArray()
      : p.role === "client"
      ? this.ctx.storage.sql.exec<Row>(`SELECT CAST(id AS TEXT) AS id,account_id,device_id,is_upstream,payload FROM messages
          WHERE is_upstream=1 AND id>CAST(? AS INTEGER) ORDER BY messages.id LIMIT ?`, after, LIMITS.page).toArray()
      : this.ctx.storage.sql.exec<Row>(`SELECT CAST(id AS TEXT) AS id,account_id,device_id,is_upstream,payload FROM messages
          WHERE device_id=? AND is_upstream=0 AND id>CAST(? AS INTEGER) ORDER BY messages.id LIMIT ?`, p.device, after, LIMITS.page).toArray();
    const messages: Message[] = rows.map(row => ({ ...row, is_upstream: Boolean(row.is_upstream), payload: JSON.parse(row.payload) }));
    return { messages, next: messages.at(-1)?.id ?? after, retained_after: floor };
  }

  async read(p: MessagePrincipal, after: string, generation = "0", owner = "", wait = 0, target?: string): Promise<Result<string>> {
    return this.result("read", async () => {
      if (target !== undefined && (p.role !== "client" || !target)) throw new DuplexError("forbidden");
      if (!Number.isInteger(wait) || wait < 0 || wait > LIMITS.waitMs) throw new DuplexError("invalid_request");
      await this.authorized(p, target);
      this.rate(p);
      const key = this.principalKey(p);
      if ((this.subscriptions.get(key) ?? 0) >= LIMITS.subscriptions) throw new DuplexError("backpressure", true);
      this.subscriptions.set(key, (this.subscriptions.get(key) ?? 0) + 1);
      try {
        const deadline = Date.now() + wait;
        for (;;) {
          const page = this.page(p, after, generation, owner, target);
          if (page.messages.length || Date.now() >= deadline) return JSON.stringify(page);
          await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now())));
          // Long-poll authorization is never a handshake-only decision.
          await this.authorized(p, target);
        }
      } finally {
        const count = (this.subscriptions.get(key) ?? 1) - 1;
        if (count) this.subscriptions.set(key, count);
        else this.subscriptions.delete(key);
      }
    });
  }

  async acknowledge(p: MessagePrincipal, id: string, generation: string, owner: string): Promise<Result<{ ack: string }>> {
    return this.result("acknowledge", async () => {
      await this.authorized(p);
      this.rate(p);
      return this.ctx.storage.transactionSync(() => {
        const lease = this.lease(p, generation, owner);
        if (!messageIdSchema.safeParse(id).success || p.role !== "device") throw new DuplexError("invalid_cursor");
        const message = this.ctx.storage.sql.exec("SELECT id FROM messages WHERE id=CAST(? AS INTEGER) AND device_id=? AND is_upstream=0", id, p.device).toArray()[0];
        if (!message) throw new DuplexError("invalid_cursor");
        const ack = BigInt(id) > BigInt(lease.ack) ? id : lease.ack;
        this.ctx.storage.sql.exec("UPDATE leases SET ack=? WHERE device=?", ack, p.device);
        return { ack };
      });
    });
  }
}
