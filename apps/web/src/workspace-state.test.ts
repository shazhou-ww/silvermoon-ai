import { describe, expect, it, vi } from "vitest"
import { SessionDrafts, workspaceRoute, workspaceUrl } from "./workspace-state"

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

const a = { connectorId: "one", sessionId: "same" }
const b = { connectorId: "two", sessionId: "same" }

describe("workspace routes", () => {
  it("keeps existing session links and distinct Settings destinations", () => {
    expect(workspaceRoute({ pathname: "/", search: "?connector=one&session=same" }))
      .toEqual({ view: "session", selection: a })
    expect(workspaceRoute({ pathname: "/settings", search: "" }))
      .toEqual({ view: "settings", selection: null })
    expect(workspaceRoute({ pathname: "/elsewhere", search: "" }).view)
      .toBe("not-found")
    expect(workspaceUrl("https://example.test/?auth=linked", "settings", a, "devices"))
      .toBe("/settings?auth=linked&connector=one&session=same#devices")
    expect(workspaceUrl("https://example.test/settings?connector=one&session=same", "session", null))
      .toBe("/")
  })
})

describe("session drafts", () => {
  it("isolates devices and accounts and survives a new store in the same tab", () => {
    const cache = storage()
    const store = new SessionDrafts(() => cache, vi.fn())
    store.load("user")
    store.write("user", a, "alpha")
    store.write("user", b, "beta")
    store.load("other")
    store.write("other", a, "other account")
    const restored = new SessionDrafts(() => cache, vi.fn())
    restored.load("user")
    expect(restored.read("user", a).text).toBe("alpha")
    expect(restored.read("user", b).text).toBe("beta")
    expect(restored.read("other", a).text).toBe("")
  })

  it("retains failed requests and commands, and clears only the submitted source version", () => {
    const store = new SessionDrafts(storage, vi.fn())
    store.load("user")
    store.write("user", a, "alpha")
    store.write("user", b, "beta")
    const first = store.begin("user", a)
    store.failRequest("user", a, first.version)
    expect(store.read("user", a).text).toBe("alpha")
    const second = store.begin("user", a)
    store.accept("user", a, second.version, "failed", "sent")
    store.finish("user", a, "failed", false)
    expect(store.read("user", a).text).toBe("alpha")
    const third = store.begin("user", a)
    store.accept("user", a, third.version, "success", "sent")
    store.write("user", a, "newer input")
    store.finish("user", a, "success", true)
    expect(store.read("user", a).text).toBe("newer input")
    const fourth = store.begin("user", a)
    store.accept("user", a, fourth.version, "last", "sent")
    store.finish("user", a, "last", true)
    expect(store.read("user", a).text).toBe("")
    expect(store.read("user", b).text).toBe("beta")
  })

  it("restores pending receipts without inventing delivery failure", () => {
    const cache = storage()
    const store = new SessionDrafts(() => cache, vi.fn())
    store.load("user")
    store.write("user", a, "alpha")
    const pending = store.begin("user", a)
    const unknown = new SessionDrafts(() => cache, vi.fn())
    unknown.load("user")
    expect(unknown.read("user", a).pending?.status).toBe("unknown")
    store.accept("user", a, pending.version, "receipt", "sent")
    const restored = new SessionDrafts(() => cache, vi.fn())
    restored.load("user")
    expect(restored.read("user", a).pending?.commandId).toBe("receipt")
    restored.status("user", a, "receipt", "unknown")
    expect(restored.read("user", a)).toMatchObject({
      text: "alpha",
      pending: { commandId: "receipt", status: "unknown" },
    })
    restored.finish("user", a, "receipt", false)
    expect(restored.read("user", a)).toMatchObject({ text: "alpha", pending: null })
  })

  it("clears only the account namespace and ignores its late receipt", () => {
    const cache = storage()
    cache.setItem("unrelated", "keep")
    const store = new SessionDrafts(() => cache, vi.fn())
    store.load("user")
    store.write("user", a, "alpha")
    const pending = store.begin("user", a)
    store.load("other")
    store.write("other", a, "other")
    store.clear("user")
    store.accept("user", a, pending.version, "late", "sent")
    expect(store.read("user", a)).toMatchObject({ text: "", pending: null })
    expect(store.read("other", a).text).toBe("other")
    expect(cache.getItem("unrelated")).toBe("keep")
  })

  it("reports corrupt caches and unavailable storage while retaining in-memory input", () => {
    const cache = storage()
    cache.setItem("silvermoon:session-drafts:user", "{broken")
    const onError = vi.fn()
    const store = new SessionDrafts(() => cache, onError)
    store.load("user")
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("could not be restored"))
    const unavailable = new SessionDrafts(
      () => { throw new Error("Storage denied") },
      onError,
    )
    unavailable.load("user")
    unavailable.write("user", a, "still editable")
    expect(unavailable.read("user", a).text).toBe("still editable")
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("could not be cached"))
    unavailable.clear("user")
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("could not be cleared"))
  })
})
