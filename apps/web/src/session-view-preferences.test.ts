import { describe, expect, it, vi } from "vitest"
import {
  loadSessionViewPreferences,
  saveSessionViewPreferences,
  sessionViewPreferencesKey,
  type SessionViewPreferences,
} from "./session-view-preferences"

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

const defaults: SessionViewPreferences = {
  showCompleted: false,
  showEnded: false, showUnavailable: false, showOffline: false, groupByDevice: false,
}

describe("session view preferences", () => {
  it("defaults to five disabled options without writing storage", () => {
    const cache = storage()
    expect(loadSessionViewPreferences(() => cache, "user"))
      .toEqual({ preferences: defaults, warning: null })
    expect(cache.length).toBe(0)
  })

  it.each(Array.from({ length: 32 }, (_, mask) => mask))("restores combination %i", (mask) => {
    const cache = storage()
    const preferences = {
      showCompleted: Boolean(mask & 16),
      showEnded: Boolean(mask & 1),
      showUnavailable: Boolean(mask & 2),
      showOffline: Boolean(mask & 4),
      groupByDevice: Boolean(mask & 8),
    }
    expect(saveSessionViewPreferences(() => cache, "user", preferences)).toBeNull()
    expect(loadSessionViewPreferences(() => cache, "user"))
      .toEqual({ preferences, warning: null })
    expect(JSON.parse(cache.getItem(sessionViewPreferencesKey("user"))!))
      .toEqual({ version: 1, ...preferences })
  })

  it("restores legacy preferences without resetting other choices", () => {
    const cache = storage()
    cache.setItem(sessionViewPreferencesKey("user"), JSON.stringify({
      version: 1, showEnded: true, showUnavailable: false, showOffline: true, groupByDevice: true,
    }))
    expect(loadSessionViewPreferences(() => cache, "user")).toEqual({
      preferences: { ...defaults, showEnded: true, showOffline: true, groupByDevice: true },
      warning: null,
    })
  })

  it("isolates accounts and preserves unrelated storage", () => {
    const cache = storage()
    cache.setItem("unrelated", "keep")
    const first = { ...defaults, showEnded: true }
    const second = { ...defaults, showOffline: true }
    saveSessionViewPreferences(() => cache, "user:/one", first)
    saveSessionViewPreferences(() => cache, "user%3A%2Fone", second)
    expect(loadSessionViewPreferences(() => cache, "user:/one").preferences).toEqual(first)
    expect(loadSessionViewPreferences(() => cache, "user%3A%2Fone").preferences).toEqual(second)
    expect(loadSessionViewPreferences(() => cache, "other").preferences).toEqual(defaults)
    expect(cache.getItem("unrelated")).toBe("keep")
  })

  it.each([
    "{broken", "null", "[]",
    JSON.stringify(defaults),
    JSON.stringify({ version: 2, ...defaults }),
    JSON.stringify({ version: 1, ...defaults, showOffline: "true" }),
    JSON.stringify({ version: 1, ...defaults, showCompleted: "true" }),
    JSON.stringify({ version: 1, showEnded: true }),
  ])("reports invalid records without rewriting them: %s", (raw) => {
    const cache = storage()
    cache.setItem(sessionViewPreferencesKey("user"), raw)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(loadSessionViewPreferences(() => cache, "user")).toEqual({
        preferences: defaults,
        warning: expect.stringContaining("could not be restored"),
      })
      expect(log).toHaveBeenCalledWith(expect.stringContaining("session-view-preferences-error"))
      expect(cache.getItem(sessionViewPreferencesKey("user"))).toBe(raw)
    } finally {
      log.mockRestore()
    }
  })

  it("reports storage access, read and write failures", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const cache = storage()
    const denied = () => { throw new Error("Storage denied") }
    try {
      expect(loadSessionViewPreferences(denied, "user").preferences).toEqual(defaults)
      expect(saveSessionViewPreferences(denied, "user", defaults)).toContain("could not be saved")
      cache.getItem = () => { throw new Error("Read denied") }
      expect(loadSessionViewPreferences(() => cache, "user").warning).toContain("could not be restored")
      cache.setItem = () => { throw new Error("Quota exceeded") }
      expect(saveSessionViewPreferences(() => cache, "user", defaults)).toContain("could not be saved")
      expect(log).toHaveBeenCalledTimes(4)
    } finally {
      log.mockRestore()
    }
  })
})
