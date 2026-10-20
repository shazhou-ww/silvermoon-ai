import { seqSchema, utf8Bytes, type EventRecord } from "@silvermoon-ai/sync-protocol"

export const WINDOW_LIMITS = { records: 2000, bytes: 8 * 1024 * 1024, rows: 200, rowHeight: 44, overscan: 8 } as const
export const compareSeq = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
export function before(seq: string): string {
  if (!seqSchema.safeParse(seq).success || seq === "0") throw new Error("Enter a positive decimal sequence.")
  return (BigInt(seq) - 1n).toString()
}

// Payloads are retained once, in a bounded window. Cursors are independent of eviction.
export class EventWindow {
  private records = new Map<string, EventRecord>()
  bytes = 0
  get size() { return this.records.size }
  get(seq: string) { return this.records.get(seq) }
  values() { return [...this.records.values()].sort((a, b) => compareSeq(a.seq, b.seq)) }
  add(events: readonly EventRecord[], direction: "forward" | "backward" = "forward") {
    events = [...events].sort((a, b) => compareSeq(a.seq, b.seq))
    for (let i = 1; i < events.length; i++) {
      if (BigInt(events[i]!.seq) !== BigInt(events[i - 1]!.seq) + 1n) throw new Error("History gap inside data window")
    }
    const existing = this.values()
    const disjoint = !!(events.length && existing.length
      && (BigInt(events[0]!.seq) > BigInt(existing.at(-1)!.seq) + 1n
        || BigInt(events.at(-1)!.seq) + 1n < BigInt(existing[0]!.seq)))
    if (disjoint) { this.records.clear(); this.bytes = 0 }
    for (const event of events) {
      const old = this.records.get(event.seq)
      if (old && old.payload !== event.payload) throw new Error(`Conflicting immutable event ${event.seq}`)
      if (!old) {
        this.records.set(event.seq, event)
        this.bytes += utf8Bytes(event.payload)
      }
    }
    const ordered = this.values()
    if (direction === "backward") ordered.reverse()
    while (this.size > WINDOW_LIMITS.records || this.bytes > WINDOW_LIMITS.bytes) {
      const evicted = ordered.shift()!
      this.records.delete(evicted.seq)
      this.bytes -= utf8Bytes(evicted.payload)
    }
    return { reset: disjoint }
  }
}

export function virtualRows(count: number, scrollTop: number, height: number) {
  const start = Math.max(0, Math.floor(scrollTop / WINDOW_LIMITS.rowHeight) - WINDOW_LIMITS.overscan)
  const end = Math.min(count, start + Math.min(WINDOW_LIMITS.rows,
    Math.ceil(height / WINDOW_LIMITS.rowHeight) + WINDOW_LIMITS.overscan * 2))
  return { start, end, top: start * WINDOW_LIMITS.rowHeight, bottom: (count - end) * WINDOW_LIMITS.rowHeight }
}

export function assertPage(events: readonly EventRecord[], after: string, head: string) {
  let expected = BigInt(after) + 1n
  for (const event of events) {
    if (BigInt(event.seq) !== expected++) throw new Error(`History gap: expected sequence ${expected - 1n}, received ${event.seq}`)
  }
  if (!events.length && BigInt(after) < BigInt(head)) throw new Error("History gap: events are unavailable before the committed head.")
}
