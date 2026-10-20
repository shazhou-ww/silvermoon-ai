import { expect, test, type Page } from "@playwright/test"
import type { AgentSessionEvent } from "../src/message-flow.ts"

function message(sequence: number, text = `Message ${sequence}`): AgentSessionEvent {
  return {
    id: `event-${sequence}`,
    sessionId: "session-1",
    sequence,
    type: "message",
    role: "assistant",
    text,
    data: null,
    createdAt: "2026-10-10T00:00:00.000Z",
  }
}

async function fixture(
  page: Page,
  initialEvents: number | AgentSessionEvent[] = 40,
) {
  const state = {
    events: Array.isArray(initialEvents)
      ? initialEvents
      : Array.from({ length: initialEvents }, (_, index) => message(index)),
    status: "online",
    delaySecondSession: false,
    eventPolls: 0,
    generation: 1,
    confirmedGeneration: 1,
    messageResult: "sent",
    sentMessages: [] as Record<string, unknown>[],
    executionStateKnown: true,
    failSessionRefresh: false,
    sessionDelayMs: 0,
    sessionRequests: 0,
    activeSessionRequests: 0,
    maxActiveSessionRequests: 0,
    omitFirstSession: false,
    stateSyncFailed: false,
    stateSyncRequests: 0,
  }
  await page.route("https://relay.silvermoon.work/**", async (route) => {
    const url = new URL(route.request().url())
    const connector = (id: string) => ({
      id,
      displayName: `Device ${id}`,
      agent: null,
      capabilities: { listSessions: true, createSession: true, sendMessage: true, streamEvents: true },
      status: state.status,
      connectionId: `${id}-connection-${state.generation}`,
      sessionSyncState: state.stateSyncFailed ? "failed" : state.generation === state.confirmedGeneration ? "ready" : "pending",
      sessionSyncError: state.stateSyncFailed ? "Current inventory refresh failed." : null,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: null,
      createdAt: "2026-10-10T00:00:00.000Z",
      sessionCount: 1,
    })
    let body: unknown
    if (url.pathname === "/api/me") {
      body = {
        user: { id: "user", displayName: "Reviewer", avatarUrl: null },
        identities: [],
        sessionId: "browser-session",
      }
    } else if (url.pathname === "/api/tokens") {
      body = [{
        id: "token-one",
        deviceId: "one",
        deviceName: "Device one",
        tokenHint: "A1b2",
        createdAt: "2026-10-10T00:00:00.000Z",
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
      }]
    } else if (url.pathname === "/api/sessions") {
      body = []
    } else if (url.pathname === "/api/connectors") {
      body = [connector("one"), connector("two")]
    } else if (url.pathname.endsWith("/events/sync")) {
      body = { command: { id: "sync", type: "sync", status: "sent" } }
    } else if (url.pathname === "/api/commands/sync") {
      body = {
        id: "sync",
        connectorId: "one",
        type: "session.history",
        sessionId: "session-1",
        status: "succeeded",
        error: null,
      }
    } else if (url.pathname.endsWith("/sessions/sync")) {
      state.stateSyncRequests++
      state.stateSyncFailed = false
      state.confirmedGeneration = state.generation
      body = { command: { id: "state-sync", type: "sessions.list", status: "sent" } }
    } else if (url.pathname === "/api/commands/state-sync") {
      body = { id: "state-sync", connectorId: "one", type: "sessions.list", sessionId: null, status: "succeeded", error: null }
    } else if (url.pathname.endsWith("/messages")) {
      state.sentMessages.push(route.request().postDataJSON())
      body = { command: { id: "follow-up", type: "session.message", status: "sent" } }
    } else if (url.pathname === "/api/commands/follow-up") {
      body = {
        id: "follow-up", connectorId: "one", type: "session.message",
        sessionId: "session-1", status: state.messageResult,
        error: state.messageResult === "unknown"
          ? { code: "command-result-unconfirmed", message: "Result not confirmed." } : null,
      }
    } else if (url.pathname.endsWith("/events")) {
      state.eventPolls++
      const second = url.pathname.includes("/two/")
      if (second && state.delaySecondSession) {
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
      const source = second
        ? Array.from({ length: 30 }, (_, index) => message(index, `Second device ${index}`))
        : state.events
      const after = Number(url.searchParams.get("after"))
      body = { events: source.filter((event) => event.sequence > after), nextAfter: source.at(-1)?.sequence ?? -1 }
    } else if (url.pathname.endsWith("/sessions")) {
      const second = url.pathname.includes("/two/")
      state.sessionRequests++
      state.activeSessionRequests++
      state.maxActiveSessionRequests = Math.max(state.maxActiveSessionRequests, state.activeSessionRequests)
      if (state.sessionDelayMs) await new Promise((resolve) => setTimeout(resolve, state.sessionDelayMs))
      state.activeSessionRequests--
      if (state.failSessionRefresh) {
        await route.fulfill({ status: 503, json: { error: "Session inventory unavailable" } })
        return
      }
      body = { sessions: !second && state.omitFirstSession ? [] : [{
        id: "session-1",
        connectorId: second ? "two" : "one",
        parentSessionId: null,
        title: second ? "Second Session" : "First Session",
        status: "idle",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        lastActivityAt: "2026-10-10T00:00:00.000Z",
        lastMessagePreview: null,
        canSendMessage: true,
        confirmedConnectionId: `${second ? "two" : "one"}-connection-${state.confirmedGeneration}`,
        executionStateKnown: state.executionStateKnown,
        capabilityConfirmed: true,
      }], nextCursor: null }
    } else {
      throw new Error(`Unexpected API request: ${route.request().method()} ${url.pathname}`)
    }
    await route.fulfill({ json: body })
  })
  await page.goto("/legacy?connector=one&session=session-1")
  return state
}

const scrollRegion = (page: Page) => page.getByRole("region", { name: "Session messages" })
const jumpButton = (page: Page) => page.getByRole("button", { name: "Jump to latest" })

test("input answers render after the waiting message", async ({ page }) => {
  const structuredEvent = (
    id: string,
    sequence: number,
    role: AgentSessionEvent["role"],
    text: string,
    partId: string,
    partIndex: number,
    partKind: "request" | "markdown",
    inputRequestId?: string,
  ): AgentSessionEvent => ({
    id,
    sessionId: "session-1",
    sequence,
    type: "message",
    role,
    text,
    data: {
      turnId: "turn-1",
      partId,
      partIndex,
      partKind,
      ...(inputRequestId
        ? {
            inputRequestId,
            inputRequestResolved: true,
          }
        : {}),
    },
    createdAt: `2026-10-10T00:00:0${sequence}.000Z`,
  })
  await fixture(page, [
    structuredEvent(
      "request",
      1,
      "user",
      "Deploy the release.",
      "request",
      0,
      "request",
    ),
    structuredEvent(
      "waiting-message",
      2,
      "assistant",
      "I need one confirmation first.",
      "markdown-1",
      0,
      "markdown",
    ),
    structuredEvent(
      "input-answer",
      3,
      "user",
      "Pause until I return.",
      "input-1",
      1,
      "request",
      "input-1",
    ),
    structuredEvent(
      "continuation",
      4,
      "assistant",
      "Okay, I will pause here.",
      "markdown-2",
      2,
      "markdown",
    ),
  ])

  const blocks = page.locator(".transcript-turn").locator(
    ":scope > .turn-response, :scope > .turn-input-answer",
  )
  await expect(blocks).toHaveCount(3)
  await expect(blocks.nth(0)).toContainText("I need one confirmation first.")
  await expect(blocks.nth(1)).toContainText("Pause until I return.")
  await expect(blocks.nth(2)).toContainText("Okay, I will pause here.")
})

test("refresh failure preserves content, blocks sending and retries both indexes without false empty state", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  const composer = page.getByRole("textbox", { name: "Follow-up message" })
  await composer.fill("Local draft survives refresh failure")
  state.failSessionRefresh = true
  await expect(page.getByText("Unable to refresh Sessions", { exact: true })).toHaveCount(1, { timeout: 8000 })
  await expect(page.getByText("No Sessions yet", { exact: true })).toHaveCount(0)
  await expect(composer).toHaveValue("Local draft survives refresh failure")
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeDisabled()
  state.failSessionRefresh = false
  await page.getByRole("button", { name: "Refresh Device information" }).press("Enter")
  await expect(page.getByText("Unable to refresh Sessions", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeEnabled()
  await expect(composer).toHaveValue("Local draft survives refresh failure")
  expect(state.sentMessages).toHaveLength(0)
})

test("slow paged inventory reads do not overlap successive refreshes", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  state.maxActiveSessionRequests = 0
  const requests = state.sessionRequests
  state.sessionDelayMs = 4200
  await expect.poll(() => state.sessionRequests, { timeout: 8000 }).toBeGreaterThan(requests)
  await page.waitForTimeout(3500)
  expect(state.maxActiveSessionRequests).toBeLessThanOrEqual(2)
  state.sessionDelayMs = 0
})

test("state sync failure keeps drafts and restores capability only after explicit state retry", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  const composer = page.getByRole("textbox", { name: "Follow-up message" })
  await composer.fill("Draft during sync failure")
  state.generation = 2
  state.stateSyncFailed = true
  await expect(page.locator(".session-connection-notice").getByText("Status sync failed", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeDisabled()
  await expect(composer).toHaveValue("Draft during sync failure")
  await page.getByRole("button", { name: "Retry state sync" }).press("Enter")
  await expect.poll(() => state.stateSyncRequests).toBe(1)
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeEnabled({ timeout: 8000 })
  await expect(composer).toHaveValue("Draft during sync failure")
  expect(state.sentMessages).toHaveLength(0)
})

test("a removed open Session clears inaccessible content without selecting another Session automatically", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  state.omitFirstSession = true
  await expect(page.getByText("The selected Session is no longer available. Choose another Session.", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText("Message 39", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Second device 29", { exact: true })).toHaveCount(0)
  await expect(page).not.toHaveURL(/connector=/)
  await expect(page.getByRole("heading", { name: "Select a Session to continue" })).toBeVisible()
})

test("confirmed continuation does not invent execution state for metadata-only Sessions", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  state.executionStateKnown = false
  await expect(page.locator(".session-item-status").first()).toHaveText("Execution state unknown", { timeout: 8000 })
  await page.getByRole("textbox", { name: "Follow-up message" }).fill("Explicitly continue saved work")
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeEnabled()
  expect(state.sentMessages).toHaveLength(0)
  await page.getByRole("button", { name: "Send follow-up" }).click()
  await expect.poll(() => state.sentMessages.length).toBe(1)
})

test("offline drafts and reconnect confirmation preserve the open Session and do not resend", async ({ page, isMobile }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  const composer = page.getByRole("textbox", { name: "Follow-up message" })
  await composer.fill("Keep this local draft")
  await scrollFromBottom(page, 900)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  const url = page.url()
  state.status = "offline"
  await expect(page.locator(".session-connection-notice").getByText("Offline", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(composer).toBeEnabled()
  await expect(composer).toHaveValue("Keep this local draft")
  expect(page.url()).toBe(url)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await composer.fill("Edited while offline")
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeDisabled()
  state.status = "online"
  state.generation = 2
  await expect(page.locator(".session-connection-notice").getByText("Syncing status", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeDisabled()
  state.confirmedGeneration = 2
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeEnabled({ timeout: 8000 })
  await expect(composer).toHaveValue("Edited while offline")
  expect(state.sentMessages).toHaveLength(0)
  await page.getByRole("button", { name: "Send follow-up" }).click()
  await expect.poll(() => state.sentMessages.length).toBe(1)
  expect(state.sentMessages[0]).toMatchObject({ connectionId: "one-connection-2", message: "Edited while offline" })
  state.messageResult = "unknown"
  await expect(page.getByText("Command result not confirmed", { exact: true })).toBeVisible()
  expect(state.sentMessages).toHaveLength(1)
  await page.getByRole("button", { name: "Stop watching this result" }).click()
  expect(state.sentMessages).toHaveLength(1)
  await composer.fill("Draft for the first Device")
  if (isMobile) await page.getByRole("button", { name: "Back to Sessions" }).click()
  await page.locator(".session-item-select").filter({ hasText: "Second Session" }).press("Enter")
  await expect(composer).toHaveValue("")
  await composer.fill("Draft for the second Device")
  if (isMobile) await page.getByRole("button", { name: "Back to Sessions" }).click()
  await page.locator(".session-item-select").filter({ hasText: "First Session" }).press("Enter")
  await expect(composer).toHaveValue("Draft for the first Device")
  expect(state.sentMessages).toHaveLength(1)
})

test("device settings use one add flow and unified device cards", async ({ page }) => {
  await fixture(page)
  await page.getByRole("button", { name: "Account menu for Reviewer" })
    .click()
  await page.getByRole("menuitem", { name: "Settings", exact: true })
    .click()
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await expect(settings.getByRole("heading", { name: "Devices", exact: true }))
    .toBeVisible()
  await expect(settings.getByText("Add device", { exact: true }).first())
    .toBeVisible()
  await expect(settings.getByText("Connection tokens", { exact: true }))
    .toHaveCount(0)
  await expect(settings.getByText("Device one", { exact: true })).toBeVisible()
  await expect(settings.getByText(/A1b2 · Last used Never/)).toBeVisible()
  await expect(settings.getByRole("button", { name: "Rotate token" })).toBeVisible()
})

async function bottomDistance(page: Page) {
  return scrollRegion(page).evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop
  )
}

async function scrollFromBottom(page: Page, distance: number) {
  await scrollRegion(page).evaluate((element, value) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - value
    element.dispatchEvent(new Event("scroll"))
  }, distance)
}

test("initial history, the exact 64px threshold, and new events follow latest", async ({ page }) => {
  const state = await fixture(page)
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(jumpButton(page)).toHaveCount(0)
  await scrollFromBottom(page, 64)
  await expect(jumpButton(page)).toHaveCount(0)
  state.events.push(message(40, "Latest appended message"))
  await expect(page.getByText("Latest appended message", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 65)
  await expect(jumpButton(page)).toBeVisible()
})

test("history survives new messages, empty polls, tool filtering, and reconnect", async ({ page }) => {
  const state = await fixture(page)
  state.events.push({ ...message(40, "Tool output"), type: "tool", role: null })
  await expect(page.getByRole("button", { name: "Show 1 tool message" })).toHaveCount(1)
  await scrollFromBottom(page, 900)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  await expect(jumpButton(page)).toBeVisible()
  state.events.push(message(41, "Appended while reading"))
  await expect(page.getByText("Appended while reading", { exact: true })).toHaveCount(1)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  const polls = state.eventPolls
  await expect.poll(() => state.eventPolls).toBeGreaterThan(polls)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await page.getByRole("button", { name: "Show 1 tool message" }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole("button", { name: "Hide tool messages" })).toHaveCount(1)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await page.getByRole("button", { name: "Hide tool messages" }).evaluate((button: HTMLButtonElement) => button.click())
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  state.status = "offline"
  await expect(page.getByText("Reconnect Device one to send a follow-up.", { exact: true })).toBeVisible({ timeout: 8000 })
  state.status = "online"
  await expect(page.getByText("Reconnect Device one to send a follow-up.", { exact: true })).toHaveCount(0, { timeout: 8000 })
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await expect(jumpButton(page)).toBeVisible()
})

test("switching Devices with the same Session ID clears stale history and resets positioning", async ({ page, isMobile }) => {
  const state = await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  state.delaySecondSession = true
  if (isMobile) await page.getByRole("button", { name: "Back to Sessions" }).click()
  await page.locator(".session-item-select").filter({ hasText: "Second Session" }).click()
  await expect(page.getByText("Message 39", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Second device 29", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(jumpButton(page)).toHaveCount(0)
})

test("pointer and keyboard jump are accessible, hide immediately, and respect reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  await expect(jumpButton(page)).toBeVisible()
  const buttonBox = await jumpButton(page).boundingBox()
  const composerBox = await page.locator(".session-composer-shell").boundingBox()
  const transcriptBox = await scrollRegion(page).boundingBox()
  expect(buttonBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  if (!buttonBox || !composerBox || !transcriptBox) throw new Error("Missing layout boxes")
  expect(buttonBox.height).toBeGreaterThanOrEqual(44)
  expect(buttonBox.width).toBeGreaterThanOrEqual(44)
  expect(Math.abs(buttonBox.width - buttonBox.height)).toBeLessThanOrEqual(1)
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(composerBox.y)
  expect(buttonBox.y).toBeGreaterThanOrEqual(transcriptBox.y)
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(transcriptBox.y + transcriptBox.height)
  expect(buttonBox.x).toBeGreaterThanOrEqual(transcriptBox.x)
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(transcriptBox.x + transcriptBox.width)
  expect(await page.locator(".transcript-shell").evaluate((element) =>
    getComputedStyle(element).paddingBottom
  )).toBe("0px")
  expect(await page.locator(".transcript").evaluate((element) =>
    getComputedStyle(element).paddingBottom
  )).toBe("16px")
  await page.screenshot({ path: testInfo.outputPath("reading-history.png") })
  await jumpButton(page).click()
  await expect(jumpButton(page)).toHaveCount(0)
  expect(await bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(scrollRegion(page)).toBeFocused()
  await scrollFromBottom(page, 900)
  await scrollRegion(page).focus()
  await page.keyboard.press("Tab")
  await expect(jumpButton(page)).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(jumpButton(page)).toHaveCount(0)
  expect(await bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(scrollRegion(page)).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath("latest.png") })
})

test("smooth jump hides immediately and can be interrupted by history scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  await jumpButton(page).click()
  await expect(jumpButton(page)).toHaveCount(0)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 1500)
  await jumpButton(page).click()
  await scrollRegion(page).dispatchEvent("wheel", { deltaY: -400 })
  await scrollFromBottom(page, 900)
  await expect(jumpButton(page)).toBeVisible()
})

test("layout changes follow only at latest, including a hidden mobile workspace", async ({ page, isMobile }) => {
  const state = await fixture(page, 0)
  await expect(page.getByText("Waiting for activity", { exact: true })).toBeVisible()
  state.events = Array.from({ length: 40 }, (_, index) => message(index))
  await expect(page.getByText("Message 39", { exact: true })).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await page.locator(".transcript").evaluate((element) => element.style.paddingBottom = "200px")
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await page.getByRole("textbox", { name: "Follow-up message" }).fill("line\n".repeat(8))
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 900)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  await page.locator(".transcript").evaluate((element) => element.style.paddingBottom = "300px")
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  await expect(jumpButton(page)).toBeVisible()
  if (isMobile) {
    await page.getByRole("button", { name: "Back to Sessions" }).click()
    state.events.push(message(40, "Arrived while hidden"))
    await expect(page.getByText("Arrived while hidden", { exact: true })).toHaveCount(1)
    await page.locator(".session-item-select").filter({ hasText: "First Session" }).click()
    expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
    await expect(jumpButton(page)).toBeVisible()
  }
})

test("structured streaming snapshots and delayed media layout preserve follow intent", async ({ page }) => {
  const state = await fixture(page)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  const snapshot = (sequence: number, text: string): AgentSessionEvent => ({
    ...message(sequence, text),
    data: {
      turnId: "streaming-turn",
      partId: "answer",
      partIndex: 0,
      partKind: "markdown",
      update: "snapshot",
    },
  })
  state.events.push(snapshot(40, "Streaming response"))
  await expect(page.getByText("Streaming response", { exact: true })).toBeVisible()
  state.events.push(snapshot(41, "Streaming response\n\n" + "Long response paragraph.\n\n".repeat(20)))
  await expect.poll(() => page.getByText("Long response paragraph.", { exact: true }).count()).toBe(20)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await page.locator(".transcript").evaluate((element) => {
    const image = document.createElement("img")
    image.alt = "Delayed media"
    image.style.height = "1px"
    image.style.width = "100%"
    element.append(image)
  })
  await page.getByAltText("Delayed media").evaluate((element) => element.style.height = "400px")
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await scrollFromBottom(page, 1000)
  const position = await scrollRegion(page).evaluate((element) => element.scrollTop)
  await page.getByAltText("Delayed media").evaluate((element) => element.style.height = "600px")
  await expect(jumpButton(page)).toBeVisible()
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
  state.events.push(snapshot(42, "Streaming response\n\n" + "Long response paragraph.\n\n".repeat(30)))
  await expect.poll(() => page.getByText("Long response paragraph.", { exact: true }).count()).toBe(30)
  expect(await scrollRegion(page).evaluate((element) => element.scrollTop)).toBe(position)
})

test("short history needs no return control and follows after mobile list navigation", async ({ page, isMobile }) => {
  const state = await fixture(page, 1)
  await expect(page.getByText("Message 0", { exact: true })).toBeVisible()
  await expect(jumpButton(page)).toHaveCount(0)
  if (isMobile) await page.getByRole("button", { name: "Back to Sessions" }).click()
  state.events.push(...Array.from({ length: 39 }, (_, index) => message(index + 1)))
  await expect(page.getByText("Message 39", { exact: true })).toHaveCount(1)
  if (isMobile) await page.locator(".session-item-select").filter({ hasText: "First Session" }).click()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1)
  await expect(jumpButton(page)).toHaveCount(0)
})
