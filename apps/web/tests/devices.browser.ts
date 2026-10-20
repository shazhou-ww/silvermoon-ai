import { expect, test, type Page } from "@playwright/test"

const origin = "https://relay.silvermoon.work"
const account = { user: { id: "device-fixture", displayName: "Reviewer", avatarUrl: null }, identities: [], sessionId: "fixture-session" }
type RecordMessage = { id: string; account_id: string; device_id: string; is_upstream: boolean; payload: unknown }
const message = (id: string, device: string, up: boolean, payload: unknown = { text: "opaque <script>not executable</script>" }): RecordMessage =>
  ({ id, account_id: account.user.id, device_id: device, is_upstream: up, payload })

async function fixture(page: Page) {
  const state = {
    account, authorized: true, failReads: "", failSend: false, holdSend: false,
    writes: [] as { path: string; body: { key: string; payload: unknown }; account: string | undefined }[],
    grants: [] as boolean[], reads: [] as string[], unexpected: [] as string[],
    records: [message("1", "one", false), message("2", "one", true), message("3", "two", true)],
  }
  await page.route(`${origin}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const answer = async (json: unknown, status = 200) => route.fulfill({ status, json })
    if (path === "/api/me") return answer(state.authorized ? state.account : { error: "authentication-required" }, state.authorized ? 200 : 401)
    if (path === "/api/logout") { state.authorized = false; return answer({ ok: true }) }
    if (path.startsWith("/api/v2/")) {
      if (!state.authorized) return answer({ error: "unauthorized" }, 401)
      if (req.headers()["x-account-id"] !== state.account.user.id) return answer({ error: "account_changed" }, 400)
    }
    if (path === "/api/v2/devices") return answer({ devices: [
      { id: "empty", displayName: "New device" }, { id: "one", displayName: "Workstation" }, { id: "two", displayName: "Travel laptop" },
    ], next: null })
    if (path === "/api/v2/account/write-access") {
      const { enabled } = req.postDataJSON() as { enabled: boolean }
      state.grants.push(enabled); return answer({ enabled })
    }
    if (/^\/api\/v2\/devices\/[^/]+\/regulations$/u.test(path)) {
      state.writes.push({ path, body: req.postDataJSON(), account: req.headers()["x-account-id"] })
      if (state.failSend) return route.abort("failed")
      if (state.holdSend) await new Promise(resolve => setTimeout(resolve, 500))
      const sent = state.writes.at(-1)!
      if (!state.records.some(m => m.id === "4")) state.records.push(message("4", path.split("/")[4], false, sent.body.payload))
      return answer({ status: "accepted", id: "4" })
    }
    if (path === "/api/v2/account/events" || path.endsWith("/messages")) {
      state.reads.push(`${path}${url.search}`)
      if (state.failReads === path) return answer({ error: "cursor_expired", retained_after: "1" }, 410)
      const after = url.searchParams.get("after") ?? "0"
      const device = path.endsWith("/messages") ? decodeURIComponent(path.split("/")[4]) : undefined
      const messages = state.records.filter(m => BigInt(m.id) > BigInt(after) && (device ? m.device_id === device : m.is_upstream)).slice(0, 32)
      if (!messages.length && url.searchParams.has("wait")) await new Promise(resolve => setTimeout(resolve, 50))
      return answer({ messages, next: messages.at(-1)?.id ?? after, retained_after: "0" })
    }
    if (path === "/api/stream-connectors") return answer({ devices: [{ id: "one", displayName: "Workstation", status: "offline" }], next: null })
    if (path.endsWith("/streams")) return answer({ streams: [{ streamId: "observations", committedThrough: "18", retainedFrom: "1", contentType: null }], next: null })
    if (path.endsWith("/events")) return answer({ events: [{ seq: "18", payload: "original v1 raw text" }], next: "18", committedThrough: "18" })
    state.unexpected.push(`${req.method()} ${path}`)
    return answer({ error: "unexpected_fixture_route" }, 500)
  })
  return state
}

async function choose(page: Page, name: string) {
  const rail = page.getByRole("complementary", { name: "Devices" })
  if (!await rail.isVisible()) await page.getByRole("button", { name: "Back to Devices" }).click()
  await rail.getByRole("button", { name }).click()
}
async function back(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Back to Devices" }).click()
}

function barrier() {
  let open!: () => void
  const ready = new Promise<void>(resolve => { open = resolve })
  return { ready, open }
}

async function pendingAccount(page: Page, state: { failSend: boolean }) {
  state.failSend = true
  await page.goto("/")
  await choose(page, "Workstation")
  await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill('{"private":"deterministic-account-one"}')
  await page.getByRole("button", { name: "Send to Workstation", exact: true }).click()
  await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeEnabled()
}

for (const failure of ["account_changed", "unauthorized"] as const) {
  test(`old scoped ${failure} hides old data without canceling the pending new-account verification`, async ({ page }) => {
    const state = await fixture(page)
    await pendingAccount(page, state)
    const oldStarted = barrier(), oldReply = barrier(), checking = barrier(), verified = barrier()
    let captured = false, holdCheck = true
    const next = { ...account, user: { ...account.user, id: "second-account", displayName: "Second" }, sessionId: "second-session" }
    await page.route(`${origin}/api/v2/**`, async route => {
      if (route.request().headers()["x-account-id"] !== account.user.id) { await route.fallback(); return }
      if (!captured) { captured = true; oldStarted.open() }
      await oldReply.ready
      await route.fulfill({ status: failure === "unauthorized" ? 401 : 400, json: { error: failure } })
    })
    await page.route(`${origin}/api/me`, async route => {
      if (!holdCheck) { await route.fallback(); return }
      holdCheck = false; checking.open()
      await verified.ready
      await route.fulfill({ json: next })
    })
    try {
      await oldStarted.ready
      state.account = next; state.records = []
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await checking.ready
      oldReply.open()
      await expect(page.getByText("deterministic-account-one", { exact: false })).toHaveCount(0)
      verified.open()
      await expect(page.getByRole("button", { name: "Account menu for Second", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Enable sending for this session", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toHaveCount(0)
      expect(state.writes).toHaveLength(1)
      expect(state.grants).toEqual([true])
    } finally { oldReply.open(); verified.open() }
  })
}

test("a completed account verification does not block fresh discovery after an old scoped rejection", async ({ page }) => {
  const state = await fixture(page)
  await pendingAccount(page, state)
  const started = barrier(), release = barrier()
  let captured = false
  await page.route(`${origin}/api/v2/**`, async route => {
    if (route.request().headers()["x-account-id"] !== account.user.id) { await route.fallback(); return }
    if (!captured) { captured = true; started.open() }
    await release.ready
    await route.fulfill({ status: 400, json: { error: "account_changed" } })
  })
  try {
    await started.ready
    state.account = { ...account, user: { ...account.user, displayName: "Refreshed first" } }
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(page.getByRole("button", { name: "Account menu for Refreshed first", exact: true })).toBeVisible()
    state.account = { ...account, user: { ...account.user, id: "second-account", displayName: "Second" }, sessionId: "second-session" }
    state.records = []
    release.open()
    await expect(page.getByText("deterministic-account-one", { exact: false })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Account menu for Second", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Enable sending for this session", exact: true })).toBeVisible()
    expect(state.writes).toHaveLength(1)
  } finally { release.open() }
})

for (const response of ["old-identity", "unauthorized"] as const) {
  test(`reordered account verification ignores a superseded ${response} response`, async ({ page }) => {
    const state = await fixture(page)
    await pendingAccount(page, state)
    const checking = barrier(), obsolete = barrier(), finished = barrier()
    let hold = true
    await page.route(`${origin}/api/me`, async route => {
      if (!hold) { await route.fallback(); return }
      hold = false; checking.open()
      await obsolete.ready
      await route.fulfill(response === "unauthorized" ? { status: 401, json: { error: "authentication-required" } } : { json: account })
      finished.open()
    })
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await checking.ready
      state.account = { ...account, user: { ...account.user, id: "second-account", displayName: "Second" }, sessionId: "second-session" }
      state.records = []
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(page.getByRole("button", { name: "Account menu for Second", exact: true })).toBeVisible()
      obsolete.open(); await finished.ready
      await expect(page.getByRole("button", { name: "Enable sending for this session", exact: true })).toBeVisible()
      await expect(page.getByRole("heading", { name: "Sign in or get started", exact: true })).toHaveCount(0)
      await expect(page.getByText("deterministic-account-one", { exact: false })).toHaveCount(0)
      expect(state.writes).toHaveLength(1)
    } finally { obsolete.open() }
  })
}

test("an overlapping invalidated account verification cannot resurrect its old private pending", async ({ page }) => {
  const state = await fixture(page)
  await pendingAccount(page, state)
  const oldStarted = barrier(), oldReply = barrier(), checking = barrier(), verified = barrier()
  let checks = 0, captured = false
  await page.route(`${origin}/api/v2/**`, async route => {
    if (route.request().headers()["x-account-id"] !== account.user.id) { await route.fallback(); return }
    if (!captured) { captured = true; oldStarted.open() }
    await oldReply.ready
    await route.fulfill({ status: 400, json: { error: "account_changed" } })
  })
  await page.route(`${origin}/api/me`, async route => {
    checks++
    if (checks !== 1) { await route.fallback(); return }
    checking.open(); await verified.ready
    await route.fulfill({ json: account })
  })
  try {
    await oldStarted.ready
    state.account = { ...account, user: { ...account.user, id: "second-account", displayName: "Second" }, sessionId: "second-session" }
    state.records = []
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await checking.ready
    oldReply.open()
    await expect(page.getByText("deterministic-account-one", { exact: false })).toHaveCount(0)
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { fixturePrivateResurrected?: boolean }
      state.fixturePrivateResurrected = false
      new MutationObserver(() => {
        if (document.body.textContent?.includes("deterministic-account-one")) state.fixturePrivateResurrected = true
      }).observe(document.body, { childList: true, characterData: true, subtree: true })
    })
    verified.open()
    await expect(page.getByRole("button", { name: "Account menu for Second", exact: true })).toBeVisible()
    expect(checks).toBe(2)
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { fixturePrivateResurrected?: boolean }).fixturePrivateResurrected)).toBe(false)
    await expect(page.getByRole("button", { name: "Enable sending for this session", exact: true })).toBeVisible()
    expect(state.writes).toHaveLength(1)
  } finally { oldReply.open(); verified.open() }
})

for (const transition of ["other-account", "same-account-new-session"] as const) {
  test(`late scoped unauthorized cannot expire the verified ${transition} identity`, async ({ page }) => {
    const state = await fixture(page)
    await pendingAccount(page, state)
    const started = barrier(), release = barrier(), finished = barrier()
    let captured = false
    await page.route(`${origin}/api/v2/**`, async route => {
      if (captured || route.request().headers()["x-account-id"] !== account.user.id) { await route.fallback(); return }
      captured = true; started.open()
      await release.ready
      await route.fulfill({ status: 401, json: { error: "unauthorized" } })
      finished.open()
    })
    try {
      await started.ready
      const cancelled = page.waitForEvent("requestfailed", request => request.url().startsWith(`${origin}/api/v2/`) && request.headers()["x-account-id"] === account.user.id)
      state.account = { ...account, user: { ...account.user, id: transition === "other-account" ? "second-account" : account.user.id, displayName: "Second" }, sessionId: "second-session" }
      state.records = []
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(page.getByRole("button", { name: "Account menu for Second", exact: true })).toBeVisible()
      await cancelled
      release.open(); await finished.ready
      await expect(page.getByRole("button", { name: "Enable sending for this session", exact: true })).toBeVisible()
      await expect(page.getByRole("heading", { name: "Sign in or get started", exact: true })).toHaveCount(0)
      if (transition === "other-account") await expect(page.getByText("deterministic-account-one", { exact: false })).toHaveCount(0)
      else {
        await expect(page.locator(".pending-send pre")).toContainText("deterministic-account-one")
        await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeDisabled()
      }
      expect(state.writes).toHaveLength(1)
      expect(state.grants).toEqual([true])
    } finally { release.open() }
  })
}

test("current-session revocation hides all private pending and stops every scoped subscription", async ({ page }) => {
  const state = await fixture(page)
  await page.clock.install()
  const scopedRequests: string[] = []
  page.on("request", request => { if (request.url().startsWith(`${origin}/api/v2/`)) scopedRequests.push(request.url()) })
  await pendingAccount(page, state)
  state.authorized = false
  await page.clock.runFor(1000)
  await expect(page.getByRole("heading", { name: "Sign in or get started", exact: true })).toBeVisible()
  await expect(page.getByText("deterministic-account-one", { exact: false })).toHaveCount(0)
  await expect(page.getByLabel("Device workspace", { exact: true })).toHaveCount(0)
  const stopped = scopedRequests.length
  await page.clock.runFor(5000)
  expect(scopedRequests).toHaveLength(stopped)
  expect(state.writes).toHaveLength(1)
  expect(state.grants).toEqual([true])
})

test("account, Device and empty-device scenarios retain all-account reception, keyboard detail and mobile Back", async ({ page, isMobile }, info) => {
  const state = await fixture(page)
  await page.goto("/")
  if (isMobile) await choose(page, "All devices")
  await expect(page.getByRole("button", { name: "View Message 2", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "View Message 3", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toHaveCount(0)
  expect(state.grants).toEqual([])
  await page.screenshot({ path: info.outputPath("01-account.png"), fullPage: true })
  await back(page, isMobile)
  await choose(page, "Workstation")
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toBeVisible()
  expect(state.reads.some(read => read.startsWith("/api/v2/devices/one/messages?after=0&wait=0"))).toBe(true)
  await expect(page.getByText("↓ Client → Device", { exact: true })).toBeVisible()
  await expect(page.getByText("↑ Device → Client", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Send to Workstation · this Device only" })).toBeVisible()
  await page.getByRole("button", { name: "View Message 1", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("region", { name: "Raw Message 1", exact: true })).toContainText("<script>not executable</script>")
  await expect(page.locator(".event-detail script")).toHaveCount(0)
  await page.getByRole("button", { name: "Close raw detail" }).click()
  await expect(page.getByLabel("Message list", { exact: true })).toBeFocused()
  state.records.push(message("5", "two", true, { text: "other Device while filtered" }))
  await expect.poll(() => state.reads.filter(r => r.startsWith("/api/v2/account/events")).length).toBeGreaterThan(1)
  await page.screenshot({ path: info.outputPath("02-device.png"), fullPage: true })
  await back(page, isMobile)
  await choose(page, "All devices")
  await expect(page.getByRole("button", { name: "View Message 5", exact: true })).toBeVisible()
  await back(page, isMobile)
  await page.getByRole("textbox", { name: "Search Devices" }).fill("New")
  await choose(page, "New device")
  await expect(page.getByText("No messages yet. Empty history is not a connection failure.")).toBeVisible()
  await expect(page.getByText("Receive-only · sending not enabled")).toBeVisible()
  await expect(page.getByRole("button", { name: "Send to New device", exact: true })).toBeDisabled()
  await expect(page.getByRole("heading", { name: "New device", exact: true }).last()).toBeVisible()
  await page.screenshot({ path: info.outputPath("03-empty.png"), fullPage: true })
  expect(state.unexpected).toEqual([])
  expect(state.writes).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await back(page, isMobile)
  await expect(page.getByRole("link", { name: "v1 Stream history", exact: true })).toHaveAttribute("href", "/history")
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("href", "/settings")
})

test("explicit opt-in, JSON guards and persisted unknown submission retry keep exactly the original target and key", async ({ page, isMobile }, info) => {
  const state = await fixture(page)
  state.failSend = true
  await page.goto("/")
  await choose(page, "Workstation")
  const send = page.getByRole("button", { name: "Send to Workstation", exact: true })
  await expect(send).toBeDisabled()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill('{"text":"hello"}')
  await expect(send).toBeDisabled()
  await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill("bad json")
  await expect(send).toBeDisabled()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill('{"text":"hello"}')
  await send.click()
  await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeEnabled()
  await expect(page.getByRole("alert")).toContainText("Result unknown")
  expect(state.writes).toHaveLength(1)
  await page.screenshot({ path: info.outputPath("02-device-unknown.png"), fullPage: true })
  const original = state.writes[0]
  expect(original.path).toBe("/api/v2/devices/one/regulations")
  await back(page, isMobile)
  await choose(page, "Travel laptop")
  await expect(page.getByText("Immutable target:", { exact: false })).toContainText("one")
  await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeDisabled()
  await page.reload()
  if (isMobile) await choose(page, "Travel laptop")
  await expect(page.getByText("Result unknown. No automatic resend.", { exact: false })).toBeVisible()
  await page.waitForTimeout(500)
  expect(state.writes).toHaveLength(1)
  expect(state.grants).toEqual([true])
  await back(page, isMobile)
  await choose(page, "Workstation")
  await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  state.failSend = false; state.holdSend = true
  await page.getByRole("button", { name: "Retry SAME request", exact: true }).click()
  await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeDisabled()
  await expect(page.locator(".pending-send [role=status]")).toContainText("Relay accepted #4 · Device receipt and execution unconfirmed.")
  await page.screenshot({ path: info.outputPath("02-device-accepted.png"), fullPage: true })
  expect(state.writes).toHaveLength(2)
  expect(state.writes[1]).toEqual(original)
  await page.reload()
  if (isMobile) await choose(page, "Workstation")
  await expect(page.locator(".pending-send [role=status]")).toContainText("Relay accepted #4")
  expect(state.writes).toHaveLength(2)
  expect(state.unexpected).toEqual([])
})

test("read errors preserve loaded messages and independent durable scopes, and history errors never become empty success", async ({ page, isMobile }) => {
  const state = await fixture(page)
  await page.goto("/")
  await choose(page, "Workstation")
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toBeVisible()
  state.failReads = "/api/v2/devices/one/messages"
  await expect(page.getByRole("button", { name: "Retry messages", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("cursor_expired")
  await page.getByRole("button", { name: "History from start", exact: true }).click()
  await expect(page.getByRole("alert").last()).toContainText("Loaded history retained")
  await expect(page.getByText("No messages yet.", { exact: false })).toHaveCount(0)
  state.failReads = ""
  await page.getByRole("button", { name: "Retry messages", exact: true }).click()
  await expect(page.getByRole("button", { name: "Retry messages", exact: true })).toHaveCount(0)
  expect(state.reads.some(r => r.startsWith("/api/v2/devices/one/messages?after=2"))).toBe(true)
  await page.reload()
  if (isMobile) await choose(page, "Workstation")
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("silvermoon:messages:v2:device-fixture")!))
  expect(saved.scopes["account:up"].next).toBe("3")
  expect(saved.scopes["device:one:both"].next).toBe("2")
  await page.getByRole("textbox", { name: "Locate Message ID", exact: true }).fill("1")
  await page.getByRole("button", { name: "Locate", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("History")
  await page.getByRole("button", { name: "Live messages", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("Live")
})

test("storage failures are visible and prevent sending without a durably saved request", async ({ page }) => {
  const state = await fixture(page)
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("silvermoon:messages:v2:")) throw new Error("fixture storage quota")
      original.call(this, key, value)
    }
  })
  await page.goto("/")
  await choose(page, "Workstation")
  await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill("{}")
  await page.getByRole("button", { name: "Send to Workstation", exact: true }).click()
  await expect(page.getByRole("alert").last()).toContainText("Not sent: fixture storage quota")
  expect(state.writes).toEqual([])
})

test("large histories bound cache, DOM and requests while preserving full decimal IDs and explicit history rereads", async ({ page }) => {
  const state = await fixture(page)
  const start = 9007199254740993n
  state.records = Array.from({ length: 220 }, (_, i) => message(String(start + BigInt(i)), "one", true, { text: "x".repeat(12000) }))
  await page.goto("/")
  await choose(page, "Workstation")
  await expect(page.locator(".stream-window-status")).toContainText(`read through #${start + 219n}`)
  await expect(page.locator(".device-message")).toHaveCount(32)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("silvermoon:messages:v2:device-fixture")!))
  for (const feed of Object.values(saved.scopes) as { messages: unknown[]; next: string }[]) {
    expect(feed.messages.length).toBeLessThanOrEqual(128)
    expect(new TextEncoder().encode(JSON.stringify(feed.messages)).byteLength).toBeLessThan(513 * 1024)
    expect(feed.next).toBe(String(start + 219n))
  }
  expect(state.reads.length).toBeLessThan(24)
  await page.getByLabel("Message list", { exact: true }).focus()
  await page.keyboard.press("End")
  await expect(page.getByRole("button", { name: `View Message ${start + 219n}`, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "History from start", exact: true }).click()
  await expect(page.getByRole("button", { name: `View Message ${start}`, exact: true })).toBeVisible()
  await expect(page.locator(".device-message")).toHaveCount(32)
  expect(state.unexpected).toEqual([])
})

test("sign-out and account switching remove another Account's pending payload and stop old subscriptions", async ({ page, isMobile }) => {
  const state = await fixture(page)
  state.failSend = true
  await page.goto("/")
  await choose(page, "Workstation")
  await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill('{"private":"account-one-fixture"}')
  await page.getByRole("button", { name: "Send to Workstation", exact: true }).click()
  await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeEnabled()
  state.account = { ...account, user: { ...account.user, id: "second-account", displayName: "Second" }, sessionId: "second-session" }
  state.records = []
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(page.getByText("account-one-fixture", { exact: false })).toHaveCount(0)
  if (isMobile) await choose(page, "Workstation")
  await expect(page.getByRole("button", { name: "Enable sending for this session", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Retry SAME request", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Account menu for Second", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Sign in or get started", exact: true })).toBeVisible()
  await expect(page.getByLabel("Device workspace", { exact: true })).toHaveCount(0)
  const reads = state.reads.length
  await page.waitForTimeout(1300)
  expect(state.reads).toHaveLength(reads)
  expect(state.writes).toHaveLength(1)
})

test("a revoked session removes loaded Device data and never silently enables writes", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/")
  await choose(page, "Workstation")
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toBeVisible()
  state.authorized = false
  await expect(page.getByRole("heading", { name: "Sign in or get started", exact: true })).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("session expired or changed")
  await expect(page.getByLabel("Device workspace", { exact: true })).toHaveCount(0)
  expect(state.grants).toEqual([])
  expect(state.writes).toEqual([])
})

test("Device deep links and browser Back/Forward preserve narrow-screen detail intent", async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto("/?device=one")
  await expect(page.getByRole("button", { name: "View Message 1", exact: true })).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Devices" })).toBeHidden()
  await page.getByRole("button", { name: "Back to Devices" }).click()
  await expect(page.getByRole("button", { name: "Workstation v2 status: Unknown", exact: true })).toBeFocused()
  await choose(page, "Travel laptop")
  await expect(page.getByRole("heading", { name: "Send to Travel laptop · this Device only", exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole("heading", { name: "Send to Workstation · this Device only", exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole("heading", { name: "Send to Travel laptop · this Device only", exact: true })).toBeVisible()
})

test("two tabs serialize a queued send against feed writes and recover the exact lost request after reload", async ({ page, context }) => {
  const first = await fixture(page)
  await page.goto("/")
  const tab = await context.newPage()
  const second = await fixture(tab)
  second.failSend = true
  await tab.goto("/?device=one")
  await choose(tab, "Workstation")
  await tab.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await tab.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill('{"text":"two-tab immutable"}')
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & { releaseFixtureLock?: () => void; fixtureLockHeld?: boolean }
    void navigator.locks.request("silvermoon:messages:v2:device-fixture", async () => {
      state.fixtureLockHeld = true
      await new Promise<void>(resolve => { state.releaseFixtureLock = resolve })
    })
  })
  await page.waitForFunction(() => (globalThis as typeof globalThis & { fixtureLockHeld?: boolean }).fixtureLockHeld)
  const send = tab.getByRole("button", { name: "Send to Workstation", exact: true })
  await send.evaluate(button => { if (button instanceof HTMLButtonElement) { button.click(); button.click() } })
  await expect(send).toBeDisabled()
  expect(second.writes).toEqual([])
  first.records.push(message("5", "two", true))
  await page.evaluate(() => (globalThis as typeof globalThis & { releaseFixtureLock?: () => void }).releaseFixtureLock?.())
  await expect(tab.getByRole("button", { name: "Retry SAME request", exact: true })).toBeEnabled()
  expect(second.writes).toHaveLength(1)
  const original = second.writes[0]
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("silvermoon:messages:v2:device-fixture")!).scopes["account:up"].next)).toBe("5")
  await tab.reload()
  await expect(tab.locator(".pending-send pre")).toContainText("two-tab immutable")
  await expect(tab.locator(".pending-send")).toContainText(original.body.key)
  expect(second.writes).toHaveLength(1)
  second.failSend = false
  await tab.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await tab.getByRole("button", { name: "Retry SAME request", exact: true }).click()
  await expect(tab.locator(".pending-send [role=status]")).toContainText("Relay accepted #4")
  expect(second.writes[1]).toEqual(original)
  expect(second.writes).toHaveLength(2)
  await tab.close()
})

test("missing Web Locks fails explicitly before any send", async ({ page }) => {
  const state = await fixture(page)
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }))
  await page.goto("/?device=one")
  await choose(page, "Workstation")
  await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click()
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill("{}")
  await page.getByRole("button", { name: "Send to Workstation", exact: true }).click()
  await expect(page.locator(".device-composer [role=alert]")).toContainText("Web Locks required")
  expect(state.writes).toEqual([])
})

test("old Device/Stream deep links open exact read-only v1 history, never substitute v2 records", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/?device=one&stream=observations&seq=18")
  await expect(page.getByRole("table", { name: "Raw events" })).toBeVisible()
  await expect(page.getByRole("button", { name: "View event 18", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "View event 18", exact: true }).click()
  await expect(page.getByRole("region", { name: "Raw event 18", exact: true })).toContainText("original v1 raw text")
  expect(state.reads).toEqual([])
  expect(state.writes).toEqual([])
})
