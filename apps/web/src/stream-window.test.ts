import { describe, expect, it } from "vitest"
import { assertPage, before, compareSeq, EventWindow, virtualRows, WINDOW_LIMITS } from "./stream-window"

describe("bounded Stream data and virtual rows", () => {
  it("pages 100000 historical events without full preloading, bounds DOM and rereads evictions", () => {
    const window = new EventWindow()
    let maximum = 0
    let requests = 0
    const read = (after: number) => {
      requests++
      return Array.from({ length: Math.min(128, 100000 - after) }, (_, i) => ({ seq: String(after + i + 1), payload: `event ${after + i + 1}` }))
    }
    window.add(read(0))
    expect(window.size).toBe(128)
    expect(requests).toBe(1)
    for (let after = 128; after < 100000; after += 128) {
      window.add(read(after))
      maximum = Math.max(maximum, window.size)
      expect(window.size).toBeLessThanOrEqual(2000)
      expect(window.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
      const rows = virtualRows(window.size, Math.max(0, window.size - 40) * 44, 900)
      expect(rows.end - rows.start).toBeLessThanOrEqual(200)
    }
    expect(maximum).toBe(2000)
    expect(window.get("1")).toBeUndefined()
    window.add(read(0), "backward")
    expect(window.get("1")?.payload).toBe("event 1")
    expect(window.get("100000")).toBeUndefined()
  })
  it("counts UTF-8 bytes, not JS characters, even with max-size opaque payloads", () => {
    const window = new EventWindow()
    const payload = "🎉".repeat(16384)
    window.add(Array.from({ length: 2000 }, (_, i) => ({ seq: String(i + 1), payload })))
    expect(window.size).toBe(128)
    expect(window.bytes).toBe(WINDOW_LIMITS.bytes)
    expect(window.add([{ seq: "1", payload }], "backward")).toEqual({ reset: true })
    expect(window.size).toBe(1)
    expect(window.bytes).toBe(65536)
    expect(window.get("1")?.payload).toBe(payload)
  })
  it("keeps sequence identity beyond 2^53 and exposes gaps and conflicting immutable data", () => {
    expect(before("9007199254740993")).toBe("9007199254740992")
    expect(compareSeq("9007199254740993", "9007199254740992")).toBe(1)
    const window = new EventWindow()
    window.add([{ seq: "9007199254740993", payload: "a" }, { seq: "9007199254740992", payload: "b" }])
    expect(window.values().map(e => e.seq)).toEqual(["9007199254740992", "9007199254740993"])
    expect(() => window.add([{ seq: "9007199254740993", payload: "changed" }])).toThrow("Conflicting")
    expect(() => before("1.2")).toThrow("positive decimal")
    expect(() => assertPage([{ seq: "3", payload: "" }], "1", "3")).toThrow("History gap")
    expect(() => assertPage([], "1", "3")).toThrow("History gap")
    expect(() => assertPage([], "0", "0")).not.toThrow()
    expect(virtualRows(2000, 0, 1000000).end).toBe(200)
  })
  it("resets disjoint pages rather than pretending an unread interval is cached", () => {
    const window = new EventWindow()
    window.add([{ seq: "500", payload: "a" }, { seq: "501", payload: "b" }])
    expect(window.add([{ seq: "1", payload: "old" }], "backward")).toEqual({ reset: true })
    expect(window.values().map(event => event.seq)).toEqual(["1"])
    expect(window.bytes).toBe(3)
    expect(window.add([{ seq: "2", payload: "next" }])).toEqual({ reset: false })
    expect(() => window.add([{ seq: "3", payload: "" }, { seq: "5", payload: "" }])).toThrow("History gap")
  })
})
