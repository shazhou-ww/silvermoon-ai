import { DurableObject } from "cloudflare:workers";
import {
  LIMITS, MAX_SEQ, SYNC_VERSION, SyncError, eventBytes, parseClientMessage,
  type ClientMessage, type EventRecord, type ServerMessage, type ErrorCode,
} from "@silvermoon-ai/sync-protocol";

interface Subscription {
  streamId: string;
  sent: string;
  acked: string;
  pending: { seq: string; bytes: number; at: number }[];
}
interface Attachment {
  id: string;
  userId: string;
  deviceId: string;
  tokenId: string;
  sessionId?: string;
  ready: boolean;
  role: "reader" | "writer";
  generation: string;
  expires: number;
  subscriptions: Record<string, Subscription>;
  requestPeriod: number;
  requests: number;
}
type StreamRow = {
  id: string;
  head: string;
  content_type: string | null;
}
type LeaseRow = { generation: string; owner: string | null; expires: number };
type BrowserStream = { streamId: string; committedThrough: string; retainedFrom: string | null; contentType?: string };
type BrowserReadResult =
  | { status: "online" | "offline" }
  | { streams: BrowserStream[]; next: string | null }
  | (BrowserStream & { events: EventRecord[]; next: string; after?: string })
  | { error: ErrorCode };
const key = (seq: string) => seq.padStart(19, "0");
const position = (seq: string) => BigInt(seq).toString();

export class DeviceSync extends DurableObject<Env> {
  private readonly inFlight = new Map<string, number>();
  private readonly appendInFlight = new Set<string>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS streams (
        id TEXT PRIMARY KEY, head TEXT NOT NULL, content_type TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        stream_id TEXT NOT NULL, seq TEXT NOT NULL, payload TEXT NOT NULL,
        bytes INTEGER NOT NULL, PRIMARY KEY (stream_id, seq)
      );
      CREATE TABLE IF NOT EXISTS writer (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        generation TEXT NOT NULL, owner TEXT, expires INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO writer VALUES (1, '0', NULL, 0);
      CREATE TABLE IF NOT EXISTS usage (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        bytes INTEGER NOT NULL, events INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO usage VALUES (1, 0, 0);
      CREATE TABLE IF NOT EXISTS sync_connections (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, wire_bytes INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Keep attachments below the runtime's small size limit. Bounded delivery windows
    // live in SQLite and are recovered on hibernation, along with fencing state.
    const active = new Set(ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as { id: string }).id));
    for (const row of ctx.storage.sql.exec<{ id: string }>("SELECT id FROM sync_connections").toArray()) {
      if (!active.has(row.id)) {
        ctx.storage.sql.exec("DELETE FROM sync_connections WHERE id=?", row.id);
        ctx.storage.sql.exec("UPDATE writer SET owner=NULL, expires=0 WHERE owner=?", row.id);
      }
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    const text = JSON.stringify(message);
    const bytes = new TextEncoder().encode(text).byteLength;
    const { id } = ws.deserializeAttachment() as { id: string };
    const row = this.ctx.storage.sql.exec<{ wire_bytes: number }>("SELECT wire_bytes FROM sync_connections WHERE id=?", id).toArray()[0];
    if (!row || ws.readyState !== WebSocket.OPEN) throw new SyncError("stale_connection", "connection closed", true);
    if (bytes > LIMITS.frameBytes || row.wire_bytes + bytes > LIMITS.connectionOutputBytes) {
      // The platform exposes no transport bufferedAmount. A lifetime output budget
      // also bounds non-subscription responses when a peer stops draining its socket.
      const error = new SyncError("quota_exceeded", "connection output budget exhausted; reconnect and resubscribe from durable cursor", true);
      ws.send(JSON.stringify({ type: "error", code: error.code, message: error.message, retryable: true }));
      const a = this.attachment(ws);
      a.expires = 0;
      this.save(a);
      this.release(a);
      ws.close(4001, error.code);
      throw error;
    }
    this.ctx.storage.sql.exec("UPDATE sync_connections SET wire_bytes=wire_bytes+? WHERE id=?", bytes, id);
    ws.send(text);
  }

  private fail(ws: WebSocket, error: SyncError, requestId?: string, extra: Partial<Extract<ServerMessage, { type: "error" }>> = {}): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    this.send(ws, { type: "error", code: error.code, message: error.message, retryable: error.retryable, requestId, ...extra });
  }

  private findAttachment(ws: WebSocket): Attachment | undefined {
    const { id } = ws.deserializeAttachment() as { id: string };
    const row = this.ctx.storage.sql.exec<{ state: string }>("SELECT state FROM sync_connections WHERE id=?", id).toArray()[0];
    return row ? JSON.parse(row.state) as Attachment : undefined;
  }

  private attachment(ws: WebSocket): Attachment {
    const a = this.findAttachment(ws);
    if (!a) throw new SyncError("stale_connection", "connection closed", true);
    return a;
  }

  private save(a: Attachment): void {
    this.ctx.storage.sql.exec(`INSERT INTO sync_connections (id, state) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state`, a.id, JSON.stringify(a));
  }

  private async authorized(a: Attachment): Promise<boolean> {
    if (a.sessionId) return this.browserAuthorized(a.userId, a.deviceId, a.sessionId);
    const row = await this.env.DB.prepare(`
      SELECT token.id FROM connection_tokens AS token
      JOIN devices AS device ON device.user_id = token.user_id AND device.id = token.device_id
      JOIN users AS account ON account.id = token.user_id
      WHERE token.id = ?1 AND token.user_id = ?2 AND token.device_id = ?3
        AND token.revoked_at IS NULL AND device.removed_at IS NULL
        AND token.scope = 'daemon:connect'
        AND (token.expires_at IS NULL OR julianday(token.expires_at) > julianday('now'))
    `).bind(a.tokenId, a.userId, a.deviceId).first();
    return row !== null;
  }

  private async browserAuthorized(userId: string, deviceId: string, sessionId: string): Promise<boolean> {
    return null !== await this.env.DB.prepare(`
      SELECT session.id FROM browser_sessions AS session
      JOIN users AS account ON account.id=session.user_id
      JOIN devices AS device ON device.user_id=session.user_id AND device.id=?2
      WHERE session.id=?3 AND session.user_id=?1 AND session.revoked_at IS NULL
        AND julianday(session.expires_at)>julianday('now') AND device.removed_at IS NULL
    `).bind(userId, deviceId, sessionId).first();
  }

  async browserRead(userId: string, deviceId: string, sessionId: string, input: string, backwards = false, latest = false): Promise<BrowserReadResult> {
    try {
      return await this.readForBrowser(userId, deviceId, sessionId, input, backwards, latest);
    } catch (error) {
      if (error instanceof SyncError) return { error: error.code };
      throw error;
    }
  }

  private async readForBrowser(userId: string, deviceId: string, sessionId: string, input: string, backwards: boolean, latest: boolean): Promise<BrowserReadResult> {
    if (!await this.browserAuthorized(userId, deviceId, sessionId)) throw new SyncError("unauthorized");
    const m = parseClientMessage(input);
    if (m.type === "ping") {
      const writer = this.lease();
      return { status: writer.owner && writer.expires > Date.now() ? "online" : "offline" };
    }
    if (m.type === "stream.list") {
      const rows = this.ctx.storage.sql.exec<StreamRow>("SELECT * FROM streams WHERE id>? ORDER BY id LIMIT ?", m.after ?? "", m.limit + 1).toArray();
      return { streams: rows.slice(0, m.limit).map(row => this.range(row)), next: rows.length > m.limit ? rows[m.limit - 1].id : null };
    }
    if (m.type === "stream.read") {
      const stream = this.stream(m.streamId);
      this.cursor(stream, m.after);
      if (backwards || latest) {
        const rows = this.ctx.storage.sql.exec<{ seq: string; payload: string }>(
          `SELECT seq,payload FROM events WHERE stream_id=? AND seq${latest ? "<=" : "<"}? ORDER BY seq DESC LIMIT ?`, m.streamId, latest ? stream.head : key(m.after), m.limit,
        ).toArray();
        const events: EventRecord[] = [];
        let bytes = 2;
        for (const row of rows) {
          const event = { seq: position(row.seq), payload: row.payload };
          bytes += eventBytes(event) + 1;
          if (bytes > LIMITS.batchBytes) break;
          events.push(event);
        }
        events.reverse();
        const after = events.length ? (BigInt(events[0].seq) - 1n).toString() : (BigInt(m.after) > 0n ? (BigInt(m.after) - 1n).toString() : "0");
        return { ...this.range(stream), events, after, next: events.at(-1)?.seq ?? after };
      }
      const events = this.read(m.streamId, m.after, m.limit);
      return { ...this.range(stream), events, next: events.at(-1)?.seq ?? m.after };
    }
    throw new SyncError("forbidden");
  }

  private lease(): LeaseRow {
    return this.ctx.storage.sql.exec<LeaseRow>("SELECT generation, owner, expires FROM writer WHERE singleton=1").one();
  }

  private assertWriter(a: Attachment): void {
    const lease = this.lease();
    if (a.role !== "writer") throw new SyncError("forbidden");
    if (lease.owner !== a.id || lease.generation !== a.generation || lease.expires <= Date.now()) {
      throw new SyncError("stale_connection", "writer fence or lease no longer valid", true);
    }
  }

  private release(a: Attachment): void {
    this.ctx.storage.sql.exec("UPDATE writer SET owner=NULL, expires=0 WHERE singleton=1 AND owner=?", a.id);
  }

  private terminate(ws: WebSocket, a: Attachment, error: SyncError): void {
    const current = this.findAttachment(ws);
    if (!current) return;
    a = current;
    try { this.fail(ws, error); } catch { /* Transport already closed. */ }
    a.expires = 0;
    this.save(a);
    this.release(a);
    ws.close(4001, error.code);
  }

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get("x-sync-user");
    const deviceId = request.headers.get("x-sync-device");
    const tokenId = request.headers.get("x-sync-token");
    const sessionId = request.headers.get("x-sync-session");
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket" || !userId || !deviceId || (!tokenId && !sessionId)) {
      return new Response("unauthorized", { status: 401 });
    }
    const a: Attachment = {
      id: crypto.randomUUID(), userId, deviceId, tokenId: tokenId ?? "", ...(sessionId ? { sessionId } : {}), ready: false,
      role: "reader", generation: "0", expires: Date.now() + LIMITS.handshakeMs,
      subscriptions: {},
      requestPeriod: Date.now(), requests: 0,
    };
    if (!await this.authorized(a)) return new Response("unauthorized", { status: 401 });
    if (this.ctx.getWebSockets().length >= LIMITS.connections) return new Response("connection quota", { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.save(a);
    pair[1].serializeAttachment({ id: a.id });
    await this.ctx.storage.setAlarm(Date.now() + LIMITS.authCheckMs);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const a = this.findAttachment(ws);
    if (!a || ws.readyState !== WebSocket.OPEN) return;
    let message: ClientMessage | undefined;
    let appendKey: string | undefined;
    let operationCompleted = false;
    const inFlight = this.inFlight.get(a.id) ?? 0;
    if (inFlight >= LIMITS.inFlightRequests) {
      this.terminate(ws, a, new SyncError("quota_exceeded", "in-flight request quota", true));
      return;
    }
    this.inFlight.set(a.id, inFlight + 1);
    try {
      if (typeof data !== "string") throw new SyncError("invalid_message", "text frames required");
      message = parseClientMessage(data);
      if (message.type === "stream.append") {
        appendKey = JSON.stringify([a.id, message.streamId]);
        if (this.appendInFlight.has(appendKey)) {
          appendKey = undefined;
          throw new SyncError("quota_exceeded", "only one append per stream may be in flight", true);
        }
        this.appendInFlight.add(appendKey);
      }
      if (!await this.authorized(a)) {
        this.terminate(ws, a, new SyncError("unauthorized"));
        return;
      }
      // Other handlers can run during D1 authorization. Always reload the attachment.
      const current = this.attachment(ws);
      if (current.expires <= Date.now()) throw new SyncError("stale_connection", "connection lease expired", true);
      if (Date.now() - current.requestPeriod >= LIMITS.authCheckMs) {
        current.requestPeriod = Date.now();
        current.requests = 0;
      }
      if (++current.requests > LIMITS.requestsPerPeriod) throw new SyncError("quota_exceeded", "request rate quota", true);
      this.save(current);
      this.handle(ws, current, message);
      this.save(current);
      // The append is complete when its durable ACK is emitted, not after the
      // optional fanout authorization awaits. The producer may now send its next batch.
      if (appendKey) {
        this.appendInFlight.delete(appendKey);
        appendKey = undefined;
      }
      operationCompleted = true;
    } catch (error) {
      const failure = error instanceof SyncError ? error : new SyncError("storage_error", "operation failed; replay or reconnect", true);
      this.fail(ws, failure, message?.requestId, message && "streamId" in message ? { streamId: message.streamId } : {});
      if (["unauthorized", "stale_connection", "unsupported_version", "payload_too_large", "storage_error", "quota_exceeded", "invalid_message"].includes(failure.code)) {
        const closed = this.findAttachment(ws);
        if (closed) {
          this.release(closed);
          closed.expires = 0;
          this.save(closed);
        }
        ws.close(4001, failure.code);
      }
    } finally {
      if (appendKey) this.appendInFlight.delete(appendKey);
      const remaining = (this.inFlight.get(a.id) ?? 1) - 1;
      if (remaining) this.inFlight.set(a.id, remaining);
      else {
        this.inFlight.delete(a.id);
        if (ws.readyState !== WebSocket.OPEN) this.ctx.storage.sql.exec("DELETE FROM sync_connections WHERE id=?", a.id);
      }
    }
    // Request results are final before optional delivery starts. A peer's transport,
    // authorization, or connection-state failure must never retract an append ACK.
    if (operationCompleted) {
      await this.deliverTo(ws, false);
      if (message?.type === "stream.append") {
        for (const socket of this.ctx.getWebSockets()) {
          if (socket !== ws) await this.deliverTo(socket, true);
        }
      }
    }
  }

  private async deliverTo(ws: WebSocket, checkAuthorization: boolean): Promise<void> {
    let connectionId: string | undefined;
    try {
      if (ws.readyState !== WebSocket.OPEN) return;
      const before = this.findAttachment(ws);
      if (!before) throw new SyncError("resubscribe_required", "subscriber state unavailable; resume from durable cursor", true);
      connectionId = before.id;
      if (checkAuthorization && !await this.authorized(before)) throw new SyncError("unauthorized");
      if (ws.readyState !== WebSocket.OPEN) return;
      const current = this.findAttachment(ws);
      if (!current) throw new SyncError("resubscribe_required", "subscriber state disappeared; resume from durable cursor", true);
      this.pump(ws, current);
    } catch (error) {
      console.error(JSON.stringify({
        event: "sync_fanout_failed", connectionId,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      }));
      const failure = error instanceof SyncError
        ? error
        : new SyncError("storage_error", "subscriber authorization or delivery failed; reconnect and resubscribe", true);
      try {
        if (ws.readyState !== WebSocket.OPEN) return;
        const current = this.findAttachment(ws);
        if (current) {
          this.terminate(ws, current, failure);
          return;
        }
      } catch (cleanupError) {
        console.error(JSON.stringify({
          event: "sync_fanout_cleanup_failed", connectionId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        }));
      }
      // Even when connection storage itself is unavailable, fail this peer closed.
      try { ws.send(JSON.stringify({ type: "error", code: failure.code, message: failure.message, retryable: failure.retryable })); } catch { /* Transport already closed. */ }
      try { ws.close(1011, "subscriber unavailable; reconnect and resubscribe"); } catch { /* Transport already closed. */ }
    }
  }

  private stream(id: string): StreamRow {
    const stream = this.ctx.storage.sql.exec<StreamRow>("SELECT * FROM streams WHERE id=?", id).toArray()[0];
    if (!stream) throw new SyncError("stream_not_found");
    return stream;
  }

  private range(row: StreamRow) {
    return {
      streamId: row.id, committedThrough: position(row.head),
      retainedFrom: row.head === key("0") ? null : "1",
      ...(row.content_type === null ? {} : { contentType: row.content_type }),
    };
  }

  private cursor(stream: StreamRow, after: string): void {
    if (BigInt(after) > BigInt(stream.head)) throw new SyncError("invalid_cursor", "cursor exceeds stream head");
  }

  private read(streamId: string, after: string, limit: number): EventRecord[] {
    const rows = this.ctx.storage.sql.exec<{ seq: string; payload: string }>(
      "SELECT seq, payload FROM events WHERE stream_id=? AND seq>? ORDER BY seq LIMIT ?", streamId, key(after), limit,
    ).toArray();
    let bytes = 2;
    const events: EventRecord[] = [];
    for (const row of rows) {
      const event = { seq: position(row.seq), payload: row.payload };
      bytes += eventBytes(event) + 1;
      if (bytes > LIMITS.batchBytes) break;
      events.push(event);
    }
    return events;
  }

  private handle(ws: WebSocket, a: Attachment, m: ClientMessage): void {
    const requestId = m.requestId;
    if (m.type === "hello") {
      if (a.ready) throw new SyncError("invalid_message", "already negotiated");
      if (m.version !== SYNC_VERSION) throw new SyncError("unsupported_version");
      if (a.sessionId && m.role !== "reader") throw new SyncError("forbidden", "browser connections are read-only");
      if (m.role === "writer") {
        this.ctx.storage.transactionSync(() => {
          const lease = this.lease();
          if (lease.owner && lease.expires > Date.now()) throw new SyncError("writer_busy", "writer lease active", true);
          if (BigInt(lease.generation) >= MAX_SEQ) throw new SyncError("quota_exceeded", "writer generation exhausted");
          a.generation = (BigInt(lease.generation) + 1n).toString();
          this.ctx.storage.sql.exec("UPDATE writer SET generation=?, owner=?, expires=? WHERE singleton=1",
            a.generation, a.id, Date.now() + LIMITS.leaseMs);
        });
      }
      a.role = m.role;
      a.ready = true;
      a.expires = Date.now() + LIMITS.leaseMs;
      this.send(ws, { type: "welcome", requestId, version: SYNC_VERSION, connectionId: a.id, generation: a.generation, limits: LIMITS });
      return;
    }
    if (!a.ready) throw new SyncError("handshake_required");
    if (a.role === "writer") this.assertWriter(a);
    a.expires = Date.now() + LIMITS.leaseMs;
    if (a.role === "writer") this.ctx.storage.sql.exec("UPDATE writer SET expires=? WHERE singleton=1 AND owner=? AND generation=?", a.expires, a.id, a.generation);
    switch (m.type) {
      case "ping":
        this.send(ws, { type: "pong", requestId });
        break;
      case "stream.open": {
        let row = this.ctx.storage.sql.exec<StreamRow>("SELECT * FROM streams WHERE id=?", m.streamId).toArray()[0];
        if (!row) {
          if (a.role !== "writer") throw new SyncError("stream_not_found");
          this.assertWriter(a);
          const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM streams").one().n;
          if (count >= LIMITS.streams) throw new SyncError("quota_exceeded", "stream quota reached");
          this.ctx.storage.sql.exec("INSERT INTO streams VALUES (?, ?, ?)", m.streamId, key("0"), m.contentType ?? null);
          row = this.stream(m.streamId);
        }
        if (m.contentType !== undefined && row.content_type !== m.contentType) throw new SyncError("content_type_conflict");
        this.send(ws, { type: "stream.opened", requestId, ...this.range(row) });
        break;
      }
      case "stream.list": {
        const rows = this.ctx.storage.sql.exec<StreamRow>("SELECT * FROM streams WHERE id>? ORDER BY id LIMIT ?", m.after ?? "", m.limit + 1).toArray();
        const more = rows.length > m.limit;
        const page = rows.slice(0, m.limit);
        this.send(ws, { type: "stream.listed", requestId, streams: page.map((row) => this.range(row)), next: more ? page.at(-1)!.id : null });
        break;
      }
      case "stream.append": {
        this.assertWriter(a);
        let expected: string | undefined;
        try {
          this.ctx.storage.transactionSync(() => {
            const stream = this.stream(m.streamId);
            let head = BigInt(stream.head);
            let bytes = 0;
            let count = 0;
            for (let i = 0; i < m.events.length; i++) {
              const event = m.events[i];
              if (i && BigInt(event.seq) !== BigInt(m.events[i - 1].seq) + 1n) {
                expected = (BigInt(m.events[i - 1].seq) + 1n).toString();
                throw new SyncError("sequence_gap", `expected ${expected}`);
              }
              const seq = BigInt(event.seq);
              if (seq <= head) {
                const old = this.ctx.storage.sql.exec<{ payload: string }>("SELECT payload FROM events WHERE stream_id=? AND seq=?", m.streamId, key(event.seq)).toArray()[0];
                if (!old) throw new SyncError("history_unverifiable");
                if (old.payload !== event.payload) throw new SyncError("event_conflict", `conflicting event ${event.seq}`);
              } else {
                if (seq !== head + 1n) {
                  expected = (head + 1n).toString();
                  throw new SyncError("sequence_gap", `expected ${expected}`);
                }
                const size = eventBytes(event);
                this.ctx.storage.sql.exec("INSERT INTO events VALUES (?, ?, ?, ?)", m.streamId, key(event.seq), event.payload, size);
                bytes += size;
                count++;
                head = seq;
              }
            }
            const usage = this.ctx.storage.sql.exec<{ bytes: number; events: number }>("SELECT bytes, events FROM usage WHERE singleton=1").one();
            if (usage.bytes + bytes > LIMITS.quotaBytes || usage.events + count > LIMITS.quotaEvents) throw new SyncError("quota_exceeded", "device log quota reached; no automatic purge");
            this.ctx.storage.sql.exec("UPDATE usage SET bytes=bytes+?, events=events+? WHERE singleton=1", bytes, count);
            this.ctx.storage.sql.exec("UPDATE streams SET head=? WHERE id=?", key(head.toString()), m.streamId);
          });
        } catch (error) {
          if (error instanceof SyncError && expected) {
            this.fail(ws, error, requestId, { streamId: m.streamId, expected });
            return;
          }
          throw error;
        }
        // SQLite transaction + DO output gate: no successful ACK escapes before durability.
        this.send(ws, { type: "stream.appended", requestId, streamId: m.streamId, committedThrough: position(this.stream(m.streamId).head) });
        break;
      }
      case "stream.read": {
        const row = this.stream(m.streamId);
        this.cursor(row, m.after);
        const events = this.read(m.streamId, m.after, m.limit);
        this.send(ws, { type: "stream.events", requestId, streamId: m.streamId, events, next: events.at(-1)?.seq ?? m.after, committedThrough: position(row.head) });
        break;
      }
      case "stream.subscribe": {
        this.cursor(this.stream(m.streamId), m.after);
        if (Object.hasOwn(a.subscriptions, m.subscriptionId)) throw new SyncError("invalid_message", "subscription ID already used");
        if (Object.keys(a.subscriptions).length >= LIMITS.subscriptions) throw new SyncError("quota_exceeded", "subscription quota");
        a.subscriptions[m.subscriptionId] = { streamId: m.streamId, sent: m.after, acked: m.after, pending: [] };
        this.send(ws, { type: "subscription.ready", requestId, subscriptionId: m.subscriptionId });
        break;
      }
      case "subscription.ack": {
        const sub = Object.hasOwn(a.subscriptions, m.subscriptionId) ? a.subscriptions[m.subscriptionId] : undefined;
        if (!sub) throw new SyncError("subscription_not_found");
        if (BigInt(m.through) > BigInt(sub.sent)) throw new SyncError("invalid_ack", "ACK exceeds delivered position");
        if (BigInt(m.through) > BigInt(sub.acked)) {
          if (!sub.pending.some((event) => event.seq === m.through)) throw new SyncError("invalid_ack");
          sub.pending = sub.pending.filter((event) => BigInt(event.seq) > BigInt(m.through));
          sub.acked = m.through;
        }
        this.send(ws, { type: "subscription.acked", requestId, subscriptionId: m.subscriptionId, through: sub.acked });
        break;
      }
      case "subscription.cancel":
        if (!Object.hasOwn(a.subscriptions, m.subscriptionId)) throw new SyncError("subscription_not_found");
        delete a.subscriptions[m.subscriptionId];
        this.send(ws, { type: "subscription.cancelled", requestId, subscriptionId: m.subscriptionId });
        break;
    }
  }

  private pump(ws: WebSocket, a: Attachment): void {
    if (!a.ready || a.expires <= Date.now()) return;
    if (Object.values(a.subscriptions).some((sub) => sub.pending[0] && Date.now() - sub.pending[0].at >= LIMITS.slowReaderMs)) {
      this.terminate(ws, a, new SyncError("slow_consumer", "resume from your durable cursor", true));
      return;
    }
    let totalEvents = Object.values(a.subscriptions).reduce((n, sub) => n + sub.pending.length, 0);
    let totalBytes = Object.values(a.subscriptions).reduce((n, sub) => n + sub.pending.reduce((b, e) => b + e.bytes, 0), 0);
    for (const [id, sub] of Object.entries(a.subscriptions)) {
      if (totalEvents >= LIMITS.windowEvents) break;
      let blocked = false;
      while (!blocked && totalEvents < LIMITS.windowEvents) {
        const events = this.read(sub.streamId, sub.sent, LIMITS.windowEvents - totalEvents);
        if (!events.length) break;
        for (const event of events) {
          const message: ServerMessage = { type: "subscription.events", subscriptionId: id, streamId: sub.streamId, events: [event], caughtUpThrough: position(this.stream(sub.streamId).head) };
          // Count full wire delivery size, including the envelope.
          const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
          if (totalBytes + bytes > LIMITS.windowBytes) { blocked = true; break; }
          sub.sent = event.seq;
          sub.pending.push({ seq: event.seq, bytes, at: Date.now() });
          totalBytes += bytes;
          totalEvents++;
          this.save(a);
          try { this.send(ws, message); }
          catch {
            this.terminate(ws, a, new SyncError("resubscribe_required", "delivery transport failed; resume from durable cursor", true));
            return;
          }
        }
      }
    }
    this.save(a);
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.findAttachment(ws);
      if (!a) continue;
      if (a.expires <= Date.now()) this.terminate(ws, a, new SyncError("stale_connection", "lease expired", true));
      else if (!await this.authorized(a)) this.terminate(ws, a, new SyncError("unauthorized"));
      else {
        const current = this.findAttachment(ws);
        if (current) this.pump(ws, current);
      }
    }
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + LIMITS.authCheckMs);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const a = this.findAttachment(ws);
    if (a) {
      this.release(a);
      a.expires = 0;
      this.save(a);
      if (!this.inFlight.has(a.id)) this.ctx.storage.sql.exec("DELETE FROM sync_connections WHERE id=?", a.id);
    }
    ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
  }

  webSocketError(ws: WebSocket): void {
    const a = this.findAttachment(ws);
    if (a) this.release(a);
    ws.close(1011, "transport error; reconnect and resubscribe");
  }
}
