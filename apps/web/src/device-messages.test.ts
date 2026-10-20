import { describe, expect, it, vi } from "vitest"
import { acceptPage, accountStorageKey, boundedFeed, browserWorkspaceLock, emptyFeed, MESSAGE_CACHE, prepareSend, readSaved, savePending as persistPending, saveScope as persistScope, scopeKey, type Feed, type Message, type PendingSend, type WorkspaceLock } from "./device-messages"

function mutex(): WorkspaceLock {
  let tail: Promise<unknown> = Promise.resolve()
  return <T,>(_name: string, operation: () => T): Promise<T> => {
    const next = tail.then(operation)
    tail = next.catch(() => {})
    return next
  }
}
const lock = mutex()
const savePending = (cache: Storage, account: string, pending: PendingSend | null, expected?: string) => persistPending(cache, account, pending, expected, lock)
const saveScope = (cache: Storage, account: string, scope: string, feed: Feed) => persistScope(cache, account, scope, feed, lock)

function storage(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null,
    getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v) }, removeItem: k => { values.delete(k) } }
}
const message = (id: string, device = "one", up = true): Message => ({ id, account_id: "account", device_id: device, is_upstream: up, payload: { text: "opaque" } })

describe("Device workspace durable state", () => {
  it("requires exactly one target, explicit write opt-in and bounded JSON", () => {
    expect(() => prepareSend(undefined, "{}", true)).toThrow("Choose a Device")
    expect(() => prepareSend("one", "{}", false)).toThrow("Enable sending")
    expect(() => prepareSend("one", "not JSON", true)).toThrow()
    expect(() => prepareSend("one", JSON.stringify("x".repeat(16384)), true)).toThrow("payload_too_large")
    expect(prepareSend("one", "null", true).submission.payload).toBeNull()
  })
  it("persists immutable target, payload and original retry key across reload, separately per account", async () => {
    const cache = storage(), pending = prepareSend("one", '{"text":"test"}', true)
    await savePending(cache, "account", pending)
    expect(readSaved(cache, "account").pending).toEqual(pending)
    expect(readSaved(cache, "other").pending).toBeNull()
    await expect(savePending(cache, "account", prepareSend("two", "{}", true))).rejects.toThrow("unresolved request")
    await expect(savePending(cache, "account", null)).rejects.toThrow("another tab")
    await savePending(cache, "account", { ...pending, accepted: "9007199254740993" })
    expect(readSaved(cache, "account").pending?.accepted).toBe("9007199254740993")
    expect((await savePending(cache, "account", pending))?.accepted).toBe("9007199254740993")
    await expect(savePending(cache, "account", null, "stale-key")).rejects.toThrow("another tab")
    await savePending(cache, "account", null, pending.submission.key)
    expect(readSaved(cache, "account").pending).toBeNull()
    const newer = prepareSend("two", "{}", true)
    await savePending(cache, "account", newer)
    await expect(savePending(cache, "account", null, pending.submission.key)).rejects.toThrow("another tab")
    await expect(savePending(cache, "account", { ...pending, accepted: "9007199254740993" })).rejects.toThrow("unresolved request")
    expect(readSaved(cache, "account").pending).toEqual(newer)
  })
  it("durably separates Account uplink and each Device bidirectional cursor without numerical rounding", async () => {
    const cache = storage()
    await saveScope(cache, "account", scopeKey(), boundedFeed([message("9007199254740993")], "9007199254740993"))
    await saveScope(cache, "account", scopeKey("one"), boundedFeed([message("1", "one", false)], "1"))
    await saveScope(cache, "account", scopeKey(), boundedFeed([message("2")], "2"))
    expect(readSaved(cache, "account").scopes[scopeKey("one")].next).toBe("1")
    expect(readSaved(cache, "account").scopes[scopeKey()].next).toBe("9007199254740993")
    expect(readSaved(cache, "other").scopes).toEqual({})
  })
  it("distinguishes loaded empty history from failure; rejects wrong scopes, regressing and expired cursors", () => {
    const page = { messages: [], next: "0", retained_after: "0" }
    expect(acceptPage(emptyFeed(), page, "account")).toEqual({ ...emptyFeed(), loaded: true })
    expect(() => acceptPage(emptyFeed(), { ...page, messages: [message("1", "two", false)], next: "1" }, "account")).toThrow("scope")
    expect(() => acceptPage(emptyFeed(), { ...page, messages: [message("1", "two")], next: "1" }, "account", "one")).toThrow("scope")
    expect(() => acceptPage(emptyFeed(), { ...page, next: "1" }, "account")).toThrow("cursor")
    expect(() => acceptPage(emptyFeed(), { ...page, retained_after: "1" }, "account")).toThrow("cursor")
  })
  it("bounds records, bytes and scopes; evicts cursor with its cache, never advances another scope", async () => {
    const cache = storage()
    await saveScope(cache, "account", scopeKey(), boundedFeed([message("1")], "1"))
    for (let i = 0; i < 20; i++) await saveScope(cache, "account", scopeKey(`d${i}`), emptyFeed())
    expect(Object.keys(readSaved(cache, "account").scopes)).toHaveLength(MESSAGE_CACHE.scopes)
    expect(readSaved(cache, "account").scopes[scopeKey()].next).toBe("1")
    expect(readSaved(cache, "account").scopes[scopeKey("d0")]).toBeUndefined()
    const feed = boundedFeed(Array.from({ length: 500 }, (_, i) => message(String(i + 1))), "500")
    expect(feed.messages).toHaveLength(128)
    expect(feed.next).toBe("500")
    const big = boundedFeed(Array.from({ length: 128 }, (_, i) => ({ ...message(String(i + 1)), payload: "x".repeat(16000) })), "128")
    expect(new TextEncoder().encode(JSON.stringify(big.messages)).byteLength).toBeLessThanOrEqual(MESSAGE_CACHE.bytes + 128)
  })
  it("surfaces unavailable, corrupt and failed persistence rather than replacing a pending request", async () => {
    const cache = storage()
    cache.setItem(accountStorageKey("account"), "{bad")
    expect(() => readSaved(cache, "account")).toThrow()
    await expect(savePending(cache, "account", prepareSend("one", "{}", true))).rejects.toThrow()
    cache.clear()
    cache.setItem = () => { throw new Error("quota") }
    await expect(savePending(cache, "account", prepareSend("one", "{}", true))).rejects.toThrow("quota")
    vi.stubGlobal("navigator", undefined)
    try { await expect(browserWorkspaceLock("test", () => true)).rejects.toThrow("Web Locks required") }
    finally { vi.unstubAllGlobals() }
  })
  it("serializes an interleaved stale feed read and another-tab pending write without erasing either", async () => {
    const cache = storage(), pending = prepareSend("one", '{"text":"lost response"}', true)
    const read = cache.getItem
    let otherTab: Promise<PendingSend | null> | undefined
    let interleave = true
    cache.getItem = key => {
      const stale = read(key)
      if (interleave) {
        interleave = false
        otherTab = savePending(cache, "account", pending)
      }
      return stale
    }
    await saveScope(cache, "account", scopeKey(), boundedFeed([message("2")], "2"))
    await otherTab
    await saveScope(cache, "account", scopeKey("one"), boundedFeed([message("1", "one", false)], "1"))
    expect(readSaved(cache, "account").pending).toEqual(pending)
    expect(readSaved(cache, "account").scopes[scopeKey()].next).toBe("2")
    const results = await Promise.allSettled([
      savePending(cache, "account", prepareSend("two", "{}", true)),
      savePending(cache, "account", prepareSend("one", "{}", true)),
    ])
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"])
    expect(readSaved(cache, "account").pending).toEqual(pending)
    const competing = storage(), second = prepareSend("two", "{}", true)
    const claims = await Promise.allSettled([savePending(competing, "account", pending), savePending(competing, "account", second)])
    expect(claims.map(result => result.status)).toEqual(["fulfilled", "rejected"])
    expect(readSaved(competing, "account").pending).toEqual(pending)
  })
})
