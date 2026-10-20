import { describe, expect, it } from "vitest"
import { DeviceAuthBoundary, sameAuthIdentity } from "./device-auth"

const first = { accountId: "first", sessionId: "session-one" }
const second = { accountId: "second", sessionId: "session-two" }

describe("Device authentication ownership", () => {
  it("keeps one scope for a confirmed identity and aborts old requests synchronously on adoption", () => {
    const boundary = new DeviceAuthBoundary()
    const old = boundary.adopt(first)
    expect(boundary.adopt({ ...first })).toBe(old)
    const request = AbortSignal.any([old.signal, new AbortController().signal])
    const next = boundary.adopt(second)
    expect(request.aborted).toBe(true)
    expect(boundary.owns(next)).toBe(true)
    expect(boundary.invalidate(old)).toBe(false)
    expect(next.signal.aborted).toBe(false)
  })

  it("rejects delayed invalidation even when an Account and session return after another identity", async () => {
    const boundary = new DeviceAuthBoundary()
    const original = boundary.adopt(first)
    let deliver!: () => void
    const late = new Promise<void>(resolve => { deliver = resolve }).then(() => boundary.invalidate(original))
    boundary.adopt(second)
    const current = boundary.adopt(first)
    deliver()
    expect(await late).toBe(false)
    expect(boundary.owns(current)).toBe(true)
    expect(current.generation).not.toBe(original.generation)
    expect(current.signal.aborted).toBe(false)
  })

  it("fences old-session failures within the same Account, without confusing session rotation with an Account match", () => {
    const boundary = new DeviceAuthBoundary()
    const old = boundary.adopt(first)
    const current = boundary.adopt({ ...first, sessionId: "rotated-session" })
    expect(sameAuthIdentity(old, current)).toBe(false)
    expect(old.signal.aborted).toBe(true)
    expect(boundary.invalidate(old)).toBe(false)
    expect(boundary.owns(current)).toBe(true)
  })

  it("fails closed for the current identity, aborting every scope request and allowing only fresh adoption", () => {
    const boundary = new DeviceAuthBoundary()
    const old = boundary.adopt(first)
    const reads = Array.from({ length: 3 }, () => AbortSignal.any([old.signal, new AbortController().signal]))
    expect(boundary.invalidate(old)).toBe(true)
    expect(reads.every(signal => signal.aborted)).toBe(true)
    expect(boundary.owns(old)).toBe(false)
    expect(boundary.invalidate(old)).toBe(false)
    const fresh = boundary.adopt(first)
    expect(fresh.generation).toBeGreaterThan(old.generation)
    expect(fresh.signal.aborted).toBe(false)
  })
})
