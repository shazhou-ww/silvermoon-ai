import type { DatabaseSync } from "node:sqlite";
import { open, unlink } from "node:fs/promises";
import {
  MAX_SEQ, SyncError, eventSchema, idSchema, seqSchema, validUnicode, type EventRecord,
} from "@silvermoon-ai/sync-protocol";
import type { ReliableEventSource } from "./sync.js";

export interface SourceStream {
  streamId: string;
  committedThrough: string;
  contentType?: string;
}

/** SQLite WAL/FULL local log; create and reopen are deliberately different operations. */
export class FileEventSource implements ReliableEventSource {
  private constructor(private readonly db: DatabaseSync) {}

  static async create(path: string): Promise<FileEventSource> {
    const file = await open(path, "wx");
    await file.close();
    let db: DatabaseSync | undefined;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      db = new DatabaseSync(path);
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE source_metadata (version INTEGER NOT NULL);
        INSERT INTO source_metadata VALUES (1);
        CREATE TABLE streams (id TEXT PRIMARY KEY, head TEXT NOT NULL, content_type TEXT);
        CREATE TABLE events (stream_id TEXT NOT NULL, seq TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY(stream_id, seq));
      `);
      return new FileEventSource(db);
    } catch (error) {
      db?.close();
      await unlink(path).catch(() => {});
      throw error;
    }
  }

  static async open(path: string): Promise<FileEventSource> {
    let db: DatabaseSync | undefined;
    try {
      const file = await open(path, "r+");
      await file.close();
      const { DatabaseSync } = await import("node:sqlite");
      db = new DatabaseSync(path, { open: true, readOnly: false });
      if (db.prepare("SELECT version FROM source_metadata").get()?.version !== 1) throw new Error("source format");
      db.prepare("SELECT id, head, content_type FROM streams LIMIT 0").all();
      db.prepare("SELECT stream_id, seq, payload FROM events LIMIT 0").all();
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      return new FileEventSource(db);
    } catch (error) {
      try { db?.close(); } catch { /* Preserve the original open failure. */ }
      const detail = error instanceof Error ? error.message : String(error);
      throw new SyncError("local_state_lost", `cannot reopen existing durable source: ${detail}; do not recreate it under the old stream IDs`, false, { cause: error });
    }
  }

  async openStream(streamId: string, contentType?: string): Promise<void> {
    idSchema.parse(streamId);
    if (contentType !== undefined && (!contentType.length || contentType.length > 256 || !validUnicode(contentType))) throw new Error("invalid content type");
    const row = this.db.prepare("SELECT content_type FROM streams WHERE id=?").get(streamId);
    if (row) {
      if (contentType !== undefined && row.content_type !== contentType) throw new SyncError("content_type_conflict");
      return;
    }
    this.db.prepare("INSERT INTO streams VALUES (?, '0', ?)").run(streamId, contentType ?? null);
  }

  async append(streamId: string, payloads: string[]): Promise<EventRecord[]> {
    if (!payloads.length || payloads.length > 128) throw new Error("invalid local batch");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT head FROM streams WHERE id=?").get(streamId);
      if (!row) throw new SyncError("stream_not_found");
      if (!seqSchema.safeParse(row.head).success) throw new SyncError("source_history_unavailable", "invalid local head");
      let head = BigInt(row.head as string);
      const events: EventRecord[] = [];
      for (const payload of payloads) {
        if (++head > MAX_SEQ) throw new SyncError("quota_exceeded", "sequence exhausted");
        const event = eventSchema.parse({ seq: head.toString(), payload });
        this.db.prepare("INSERT INTO events VALUES (?, ?, ?)").run(streamId, event.seq.padStart(19, "0"), payload);
        events.push(event);
      }
      this.db.prepare("UPDATE streams SET head=? WHERE id=?").run(head.toString(), streamId);
      this.db.exec("COMMIT");
      return events;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async listStreams(): Promise<SourceStream[]> {
    return this.db.prepare("SELECT * FROM streams ORDER BY id").all().map((row) => ({
      streamId: row.id as string, committedThrough: row.head as string,
      ...(row.content_type === null ? {} : { contentType: row.content_type as string }),
    }));
  }

  async read(streamId: string, after: string, limit: number): Promise<EventRecord[]> {
    return this.db.prepare("SELECT seq, payload FROM events WHERE stream_id=? AND seq>? ORDER BY seq LIMIT ?")
      .all(streamId, after.padStart(19, "0"), limit).map((row) => ({ seq: BigInt(row.seq as string).toString(), payload: row.payload as string }));
  }

  async waitForChange(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    // Polling also observes commits by another local process; never relies on a lossy callback.
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 250);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  close(): void { this.db.close(); }
}
