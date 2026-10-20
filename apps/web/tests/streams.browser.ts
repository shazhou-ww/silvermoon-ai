import { expect, test, type Page } from "@playwright/test"

const origin = "https://relay.silvermoon.work"
const account = { user: { id: "stream-account", displayName: "Reviewer", avatarUrl: null }, identities: [{ provider: "github", email: "reviewer@example.test" }], sessionId: "browser" }

async function fixture(page: Page, options: { empty?: boolean; failed?: boolean; huge?: boolean; long?: boolean; zero?: boolean; gap?: boolean; byteLimited?: boolean } = {}) {
  const reads: string[] = []
  const state = { failed: !!options.failed, holdAfter: "", gate: Promise.resolve() }
  await page.route(`${origin}/api/**`, async route => {
    const url = new URL(route.request().url())
    let json: unknown
    if (url.pathname === "/api/me") json = account
    else if (url.pathname === "/api/logout") json = { ok: true }
    else if (url.pathname === "/api/stream-connectors") json = { devices: [{ id: "one", displayName: "Studio", status: "offline" }, { id: "two", displayName: "Laptop", status: "online" }], next: null }
    else if (url.pathname.endsWith("/streams")) json = { streams: options.empty ? [] : [{ streamId: "observations", committedThrough: options.zero ? "0" : options.huge ? "9007199254741000" : "100000", retainedFrom: options.zero ? null : "1", contentType: "application/vnd.unknown.v9+json" }], next: null }
    else if (url.pathname.endsWith("/events")) {
      reads.push(url.searchParams.has("tail") ? "tail" : url.searchParams.has("before") ? `before:${url.searchParams.get("before")}` : url.searchParams.get("after") ?? "0")
      if (url.searchParams.get("after") === state.holdAfter) await state.gate
      if (state.failed) { await route.fulfill({ status: 503, json: { error: "storage-unavailable" } }); return }
      const boundary = url.searchParams.get("before")
      const head = options.zero ? 0n : options.huge ? 9007199254741000n : 100000n
      const end = url.searchParams.has("tail") ? head : boundary ? BigInt(boundary) - 1n : null
      const pageSize = options.byteLimited ? 1n : 128n
      const after = end !== null ? (end > pageSize ? end - pageSize : 0n) : BigInt(url.searchParams.get("after") ?? "0")
      const available = (end ?? head) - after
      const length = Number(available > pageSize ? pageSize : available)
      json = { events: Array.from({ length }, (_, i) => {
        const seq = (after + BigInt(i) + (options.gap && i === 0 ? 2n : 1n)).toString()
        return { seq, payload: options.long ? "🎉".repeat(16384) : `{"seq":"${seq}","text":"<script>never execute</script>"}` }
      }), next: (after + BigInt(length)).toString(), committedThrough: head.toString(), ...(end !== null ? { after: after.toString() } : {}) }
    } else throw new Error(`Unexpected Stream API: ${url.pathname}`)
    await route.fulfill({ json })
  })
  return { reads, state }
}
async function choose(page: Page) {
  await page.getByRole("complementary", { name: "Streams" }).getByRole("button", { name: /observations/ }).first().click()
  await expect(page.getByRole("table", { name: "Raw events" })).toBeVisible()
  await expect(page.locator(".stream-window-status")).toContainText("128 cached")
}

test("retains the shell, offline history, literal raw detail, mobile list/detail and settings navigation", async ({ page, isMobile }) => {
  const { reads } = await fixture(page)
  await page.goto("/")
  await expect(page.getByRole("complementary", { name: "Streams" })).toBeVisible()
  await expect(page.getByText("Offline · history available")).toBeVisible()
  if (!isMobile) expect(await page.locator(".session-rail").evaluate(e => e.getBoundingClientRect().width)).toBe(304)
  await choose(page)
  expect(reads).toEqual(["0"])
  await expect(page.locator(".event-row")).not.toHaveCount(0)
  expect(await page.locator(".event-row").count()).toBeLessThanOrEqual(200)
  await expect(page.getByText(/No built-in view for application\/vnd.unknown.v9/)).toBeVisible()
  await page.getByRole("button", { name: "View event 1", exact: true }).click()
  await expect(page.getByRole("region", { name: "Raw event 1", exact: true }).locator("pre").first()).toContainText("<script>never execute</script>")
  expect(await page.locator(".event-detail script").count()).toBe(0)
  await page.getByRole("button", { name: "Close raw detail" }).click()
  await expect(page.getByRole("table", { name: "Raw events" })).toBeFocused()
  if (isMobile) {
    await page.getByRole("button", { name: "Back to Streams" }).click()
    await expect(page.getByRole("complementary", { name: "Streams" })).toBeVisible()
    await expect(page.getByRole("table", { name: "Raw events" })).toBeHidden()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("button", { name: "Account menu for Reviewer" }).click()
  await expect(page.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings")
})

test("100000 historical events are paged, truly virtualized, bounded and reread after eviction without losing focus or anchor", async ({ page }) => {
  const { reads } = await fixture(page)
  await page.goto("/")
  await choose(page)
  expect(reads).toHaveLength(1)
  for (let i = 0; i < 18; i++) {
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expect(page.locator(".stream-window-status")).toContainText(`${Math.min((i + 2) * 128, 2000)} cached`)
  }
  expect(reads).toHaveLength(19)
  expect(await page.locator(".stream-events").getAttribute("data-cache-records")).toBe("2000")
  expect(Number(await page.locator(".stream-events").getAttribute("data-cache-bytes"))).toBeLessThanOrEqual(8 * 1024 * 1024)
  const table = page.getByRole("table", { name: "Raw events" })
  await table.focus()
  await table.press("End")
  await expect(page.locator(".event-row").last()).toHaveAttribute("data-event-seq", "2432")
  expect(await page.locator(".event-row").count()).toBeLessThanOrEqual(200)
  expect(await page.locator(".event-row").count()).toBeLessThan(2000)
  await expect(table).toBeFocused()
  const focused = page.getByRole("button", { name: "View event 2432", exact: true })
  await focused.focus()
  await table.evaluate(element => { element.scrollTop = 0 })
  await expect(focused).toBeFocused()
  await expect(focused).toHaveCount(1)
  expect(await page.locator(".event-row").count()).toBeLessThanOrEqual(200)
  await table.focus()
  await table.press("End")
  await expect(page.locator(".event-row").last()).toHaveAttribute("data-event-seq", "2432")
  const anchor = await page.locator(".event-row").first().getAttribute("data-event-seq")
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.locator(`.event-row[data-event-seq="${anchor}"]`)).toBeVisible()
  await page.getByRole("textbox", { name: "Locate sequence" }).fill("1")
  await page.getByRole("button", { name: "Locate", exact: true }).click()
  await expect(page.locator(".event-row").first()).toHaveAttribute("data-event-seq", "1")
  expect(reads.at(-1)).toBe("0")
  await page.getByRole("textbox", { name: "Locate sequence" }).fill("99999")
  await page.getByRole("button", { name: "Locate", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("99999–100000")
  expect(reads.at(-1)).toBe("99998")
  expect(reads.length).toBeLessThan(25)
})

test("long payloads cannot expand virtual rows or the byte cache, copy failures remain explicit", async ({ page }) => {
  await fixture(page, { long: true })
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied") } } }))
  await page.goto("/")
  await choose(page)
  await expect(page.locator(".stream-events")).toHaveAttribute("data-cache-bytes", String(8 * 1024 * 1024))
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("129–256")
  await expect(page.locator(".stream-events")).toHaveAttribute("data-cache-records", "128")
  expect(await page.locator(".event-row").first().evaluate(e => e.getBoundingClientRect().height)).toBe(44)
  await page.getByRole("button", { name: "Copy event 129", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Copy failed for event 129")
  await page.getByRole("button", { name: "View event 129", exact: true }).click()
  await expect(page.getByRole("region", { name: "Raw event 129" }).locator("pre").first()).toHaveText("🎉".repeat(16384))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("empty, failed fetch, retry, legacy link retirement and unknown link are distinct", async ({ page }) => {
  const { state } = await fixture(page, { failed: true })
  await page.goto("/?connector=one&session=old")
  await expect(page.getByText("Legacy Session links are not Stream identities.", { exact: false })).toBeVisible()
  await expect(page.getByRole("link", { name: "Open retained Session history" })).toHaveAttribute("href", "/legacy?connector=one&session=old")
  await page.getByRole("complementary", { name: "Streams" }).getByRole("button", { name: /observations/ }).first().click()
  await expect(page.getByRole("alert")).toContainText("storage-unavailable")
  await expect(page.getByText("No events yet.", { exact: true })).toHaveCount(0)
  state.failed = false
  await page.getByRole("button", { name: "Retry read" }).click()
  await expect(page.locator(".stream-window-status")).toContainText("128 cached")
  await page.goto("/?device=missing&stream=observations")
  await expect(page.getByRole("alert")).toContainText("Stream link unavailable")
})

test("decimal locate never rounds sequence identities beyond 2^53", async ({ page }) => {
  const { reads } = await fixture(page, { huge: true })
  await page.goto("/")
  await choose(page)
  await page.getByRole("textbox", { name: "Locate sequence" }).fill("9007199254740993")
  await page.getByRole("button", { name: "Locate", exact: true }).click()
  await expect(page.locator(".event-row").first()).toHaveAttribute("data-event-seq", "9007199254740993")
  expect(reads.at(-1)).toBe("9007199254740992")
})

test("follow, pause, resume and subscription authorization expiry preserve processed position", async ({ page }) => {
  await fixture(page)
  const resumed: string[] = []
  let deliver: ((data: string) => void) | undefined
  await page.routeWebSocket(/\/api\/stream-connectors\/one\/subscribe/, ws => {
    deliver = data => ws.send(data)
    ws.onMessage(data => {
      const message = JSON.parse(String(data))
      if (message.type === "hello") {
        expect(message.role).toBe("reader")
        ws.send(JSON.stringify({ type: "welcome", requestId: message.requestId, version: 1, connectionId: "browser-only", generation: "0", limits: {} }))
      } else if (message.type === "stream.subscribe") {
        resumed.push(message.after)
        ws.send(JSON.stringify({ type: "subscription.ready", requestId: message.requestId, subscriptionId: "events" }))
        ws.send(JSON.stringify({ type: "subscription.events", subscriptionId: "events", streamId: "observations", events: [{ seq: (BigInt(message.after) + 1n).toString(), payload: "live" }], caughtUpThrough: "100000" }))
      } else if (message.type === "subscription.ack") {
        ws.send(JSON.stringify({ type: "subscription.acked", requestId: message.requestId, subscriptionId: "events", through: message.through }))
      }
    })

  })
  await page.goto("/")
  await choose(page)
  await page.getByRole("button", { name: "Follow from position" }).click()
  await expect(page.locator(".stream-window-status")).toContainText("129 cached")
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByRole("button", { name: "Follow from position" }).click()
  await expect(page.locator(".stream-window-status")).toContainText("130 cached")
  expect(resumed).toEqual(["128", "129"])
  deliver!(JSON.stringify({ type: "error", code: "unauthorized", message: "session expired or device removed", retryable: false }))
  await expect(page.getByRole("heading", { name: "Sign in or get started" })).toBeVisible()
  await expect(page.getByRole("table", { name: "Raw events" })).toHaveCount(0)
  await expect(page.getByRole("alert")).toContainText("session expired")
})

test("continuous catchup coalesces ACKs below the request quota and reconnects without gaps or duplicate rows", async ({ page }) => {
  await fixture(page)
  const resumes: string[] = []
  const acks: string[] = []
  await page.routeWebSocket(/\/api\/stream-connectors\/one\/subscribe/, ws => {
    ws.onMessage(data => {
      const message = JSON.parse(String(data))
      if (message.type === "hello") ws.send(JSON.stringify({ type: "welcome", requestId: message.requestId, version: 1, connectionId: "browser", generation: "0", limits: {} }))
      else if (message.type === "stream.subscribe") {
        resumes.push(message.after)
        const count = resumes.length === 1 ? 128 : 1
        for (let i = 1; i <= count; i++) ws.send(JSON.stringify({
          type: "subscription.events", subscriptionId: "events", streamId: "observations",
          events: [{ seq: (BigInt(message.after) + BigInt(i)).toString(), payload: "catchup" }], caughtUpThrough: "100000",
        }))
      } else if (message.type === "subscription.ack") {
        acks.push(message.through)
        if (resumes.length === 1) {
          ws.send(JSON.stringify({ type: "error", code: "quota_exceeded", message: "connection output budget; reconnect", retryable: true }))
        }
      }
    })
  })
  await page.goto("/")
  await choose(page)
  await page.getByRole("button", { name: "Follow from position" }).click()
  await expect.poll(() => acks[0]).toBe("256")
  await expect(page.locator(".stream-window-status")).toContainText("257 cached")
  expect(resumes).toEqual(["128", "256"])
  expect(acks.filter(seq => BigInt(seq) <= 256n)).toEqual(["256"])
  await expect(page.locator('.event-row[data-event-seq="257"]')).toHaveCount(1)
  expect(await page.locator(".event-row").count()).toBeLessThanOrEqual(200)
})

test("no-producer empty state is not an API failure", async ({ page }) => {
  await fixture(page, { empty: true })
  await page.goto("/")
  await expect(page.getByText("No Streams produced yet.")).toHaveCount(2)
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("an existing empty Stream is an empty log, not a failed read", async ({ page }) => {
  const { reads } = await fixture(page, { zero: true })
  await page.goto("/")
  await page.getByRole("complementary", { name: "Streams" }).getByRole("button", { name: /observations/ }).first().click()
  await expect(page.getByText("No events yet.", { exact: true })).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
  expect(reads).toEqual(["0"])
})

test("unavailable historical sequences produce an explicit gap rather than a normal empty log", async ({ page }) => {
  await fixture(page, { gap: true })
  await page.goto("/")
  await page.getByRole("complementary", { name: "Streams" }).getByRole("button", { name: /observations/ }).first().click()
  await expect(page.getByRole("alert")).toContainText("History gap: expected sequence 1, received 2")
  await expect(page.getByText("No events yet.", { exact: true })).toHaveCount(0)
  await expect(page.locator(".event-row")).toHaveCount(0)
})

test("Stream rows reuse the Session visual grammar and keyboard selection", async ({ page, isMobile }, testInfo) => {
  await fixture(page)
  await page.goto("/")
  const row = page.locator(".session-list-item").first()
  const select = row.locator(".session-item-select")
  await expect(row.locator(".session-tree-control .session-state-dot")).toHaveCount(1)
  await expect(row.locator(".session-item-title-line")).toHaveText("observations")
  expect(await row.evaluate(element => getComputedStyle(element).paddingLeft)).toBe(isMobile ? "14.4px" : "12px")
  await select.focus()
  await select.press("Enter")
  await expect(select).toHaveAttribute("aria-current", "page")
  if (isMobile) await page.getByRole("button", { name: "Back to Streams", exact: true }).click()
  await expect(row).toBeVisible()
  expect(await row.evaluate(element => getComputedStyle(element).boxShadow)).toContain("inset")
  await page.screenshot({ path: testInfo.outputPath("streams-rail.png"), fullPage: true })
})

test("automatic inventory refresh retains loaded prefixes, active detail, cursor and mobile list state", async ({ page, isMobile }) => {
  await page.clock.install()
  let status = "offline"
  let head = "100000"
  let newStream = false
  let failed = false
  const { reads } = await fixture(page)
  const resumes: string[] = []
  let connections = 0
  await page.routeWebSocket(/\/api\/stream-connectors\/device-32\/subscribe/, ws => {
    connections++
    ws.onMessage(data => {
      const message = JSON.parse(String(data))
      if (message.type === "hello") ws.send(JSON.stringify({ type: "welcome", requestId: message.requestId, version: 1, connectionId: "inventory-reader", generation: "0", limits: {} }))
      if (message.type === "stream.subscribe") resumes.push(message.after)
    })
  })
  await page.route(`${origin}/api/stream-connectors**`, async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/events")) { await route.fallback(); return }
    if (failed) { await route.fulfill({ status: 503, json: { error: "inventory-unavailable" } }); return }
    if (url.pathname === "/api/stream-connectors") {
      const all = Array.from({ length: 33 }, (_, i) => ({ id: `device-${String(i).padStart(2, "0")}`, displayName: `Producer ${i}`, status }))
      const start = url.searchParams.has("after") ? all.findIndex(d => d.id === url.searchParams.get("after")) + 1 : 0
      await route.fulfill({ json: { devices: all.slice(start, start + 32), next: start + 32 < all.length ? all[start + 31]!.id : null } })
    } else {
      const all = url.pathname.includes("device-32") ? Array.from({ length: newStream ? 41 : 40 }, (_, i) => ({ streamId: `stream-${String(i).padStart(2, "0")}`, committedThrough: head, retainedFrom: "1", contentType: "application/vnd.unknown.v9+json" })) : []
      const start = url.searchParams.has("after") ? all.findIndex(s => s.streamId === url.searchParams.get("after")) + 1 : 0
      await route.fulfill({ json: { streams: all.slice(start, start + 32), next: start + 32 < all.length ? all[start + 31]!.streamId : null } })
    }
  })
  await page.goto("/")
  await page.getByRole("button", { name: "More Connectors", exact: true }).click()
  await page.getByRole("button", { name: "More Streams", exact: true }).click()
  await page.getByRole("button", { name: /stream-35 application/ }).click()
  await expect(page.locator(".stream-window-status")).toContainText("128 cached")
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("256 cached")
  const detail = await page.locator(".stream-events").elementHandle()
  await page.getByRole("button", { name: "Follow from position", exact: true }).click()
  await expect.poll(() => resumes).toEqual(["256"])
  status = "online"; head = "100010"; newStream = true
  await page.clock.runFor(5100)
  await expect(page.locator(".stream-range")).toContainText("Sync online · committed through #100010")
  expect(await detail!.evaluate(element => element.isConnected)).toBe(true)
  expect(reads).toEqual(["0", "128"])
  await expect(page.locator(".session-list-item.is-selected")).toContainText("stream-35")
  if (isMobile) await page.getByRole("button", { name: "Back to Streams", exact: true }).click()
  await expect(page.getByRole("button", { name: /stream-40 application/ })).toBeVisible()
  status = "offline"
  await page.clock.runFor(5100)
  await expect(page.getByRole("complementary", { name: "Streams" })).toBeVisible()
  await expect(page.locator(".session-list-item.is-selected")).toContainText("Through #100010")
  failed = true
  await page.clock.runFor(5100)
  await expect(page.getByRole("complementary", { name: "Streams" }).getByRole("alert")).toContainText("loaded inventory retained")
  await expect(page.getByRole("button", { name: /stream-35 application/ })).toBeVisible()
  failed = false
  await page.clock.runFor(5100)
  await expect(page.getByRole("complementary", { name: "Streams" }).getByRole("alert")).toHaveCount(0)
  if (isMobile) await page.getByRole("button", { name: /stream-35 application/ }).click()
  await expect(page.locator(".stream-range")).toContainText("Offline history")
  expect(await detail!.evaluate(element => element.isConnected)).toBe(true)
  expect(reads).toEqual(["0", "128"])
  expect(connections).toBe(1)
  expect(resumes).toEqual(["256"])
})

test("64KiB one-event pages read exact predecessors, retain contiguous cursors and explicitly recover evicted focus", async ({ page }) => {
  test.setTimeout(60000)
  const { reads, state } = await fixture(page, { long: true, byteLimited: true })
  const resumes: string[] = []
  await page.routeWebSocket(/\/api\/stream-connectors\/one\/subscribe/, ws => {
    ws.onMessage(data => {
      const message = JSON.parse(String(data))
      if (message.type === "hello") ws.send(JSON.stringify({ type: "welcome", requestId: message.requestId, version: 1, connectionId: "reader", generation: "0", limits: {} }))
      else if (message.type === "stream.subscribe") {
        resumes.push(message.after)
        ws.send(JSON.stringify({ type: "subscription.events", streamId: "observations", subscriptionId: "events", events: [{ seq: (BigInt(message.after) + 1n).toString(), payload: "🎉".repeat(16384) }], caughtUpThrough: "100000" }))
      }
    })
  })
  await page.goto("/")
  await page.getByRole("complementary", { name: "Streams" }).getByRole("button", { name: /observations/ }).first().click()
  await expect(page.locator(".stream-window-status")).toContainText("1 cached")
  // Locate near the cache boundary, then fill only 128 actual byte-limited pages.
  for (let i = 1; i < 128; i++) {
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expect(page.locator(".stream-window-status")).toContainText(`${i + 1} cached`)
  }
  let release!: () => void
  state.holdAfter = "128"
  state.gate = new Promise<void>(resolve => { release = resolve })
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.getByText("Reading events…")).toBeVisible()
  await page.getByRole("button", { name: "View event 1", exact: true }).focus()
  release()
  await expect(page.locator(".stream-window-status")).toContainText("2–129")
  await expect(page.getByRole("table", { name: "Raw events" })).toBeFocused()
  await expect(page.getByText("The focused event left the bounded cache.", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Previous page", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("1–128")
  expect(reads.at(-1)).toBe("before:2")
  await page.getByRole("button", { name: "Follow from position", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("2–129")
  expect(resumes).toEqual(["128"])
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(page.locator(".stream-events")).toHaveAttribute("data-cache-records", "128")
  await expect(page.locator(".stream-events")).toHaveAttribute("data-cache-bytes", String(8 * 1024 * 1024))
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByRole("button", { name: "Latest history", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("100000–100000")
  expect(reads.at(-1)).toBe("tail")
  await page.getByRole("button", { name: "Previous page", exact: true }).click()
  await expect(page.locator(".stream-window-status")).toContainText("99999–100000")
  expect(reads.at(-1)).toBe("before:100000")
})

test("built-in versioned registry isolates decoding/render failures and always permits raw fallback", async ({ page }) => {
  await fixture(page)
  await page.goto("/tests/stream-view-harness.html")
  await expect(page.getByRole("table", { name: "Raw events" })).toBeVisible()
  await page.getByRole("button", { name: "Test v1" }).click()
  await expect(page.getByText("Bounded built-in: observations")).toBeVisible()
  await expect(page.getByRole("table", { name: "Raw events" })).toHaveCount(0)
  await page.getByRole("button", { name: "Fail decoder" }).click()
  await expect(page.getByRole("alert")).toContainText("View failed: test decoder failure")
  await page.getByRole("button", { name: "Show raw events" }).click()
  await expect(page.getByRole("table", { name: "Raw events" })).toBeVisible()
  await page.getByRole("button", { name: "View event 1", exact: true }).click()
  await expect(page.getByRole("region", { name: "Raw event 1" })).toBeVisible()
})
