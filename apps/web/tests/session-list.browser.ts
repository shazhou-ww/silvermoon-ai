import { expect, test, type Page } from "@playwright/test"
import type { AgentInputRequest, SessionWorkState } from "@silvermoon-ai/protocol"

interface SessionFixture {
  id: string
  connectorId: string
  parentSessionId: string | null
  title: string
  status: string
  lastActivityAt: string
}

const optionInputRequest: AgentInputRequest = {
  id: "input-signing",
  message: "Choose the certificate that should sign this release.",
  url: null,
  questions: [{
    id: "certificate",
    kind: "single-select",
    title: "Signing certificate",
    message: "Which identity should be used?",
    required: true,
    allowFreeformInput: true,
    options: [{
      id: "distribution",
      label: "Apple Distribution",
      description: "Use the shared release certificate.",
      recommended: true,
    }, {
      id: "development",
      label: "Apple Development",
    }],
  }],
}

const sessions: SessionFixture[] = [
  {
    id: "release",
    connectorId: "studio",
    parentSessionId: null,
    title: "Release desktop client",
    status: "running",
    lastActivityAt: "2026-10-10T12:00:00.000Z",
  },
  {
    id: "signing",
    connectorId: "studio",
    parentSessionId: "release",
    title: "Confirm signing identity",
    status: "waiting",
    lastActivityAt: "2026-10-10T11:55:00.000Z",
  },
  {
    id: "ended",
    connectorId: "studio",
    parentSessionId: null,
    title: "Completed migration",
    status: "closed",
    lastActivityAt: "2026-10-09T12:00:00.000Z",
  },
  {
    id: "browser",
    connectorId: "work",
    parentSessionId: null,
    title: "Investigate browser tests",
    status: "idle",
    lastActivityAt: "2026-10-10T11:30:00.000Z",
  },
  {
    id: "unavailable",
    connectorId: "work",
    parentSessionId: null,
    title: "Unavailable connector work",
    status: "gone",
    lastActivityAt: "2026-10-09T11:00:00.000Z",
  },
  {
    id: "preview",
    connectorId: "travel",
    parentSessionId: null,
    title: "Repair preview deployment",
    status: "failed",
    lastActivityAt: "2026-10-10T10:00:00.000Z",
  },
]

async function fixture(
  page: Page,
  historyCommandStatus: "succeeded" | "failed" = "succeeded",
  pendingInputRequest: AgentInputRequest | null = optionInputRequest,
  deviceState = { status: "online", generation: 1, confirmedGeneration: 1 },
  accountState = { authenticated: true, user: "user" },
  workStatus: {
    values: Map<string, SessionWorkState>
    failure: boolean
    gate: Promise<void>
    requests: string[]
    removed: boolean
    titles?: Map<string, string>
  } = { values: new Map(), failure: false, gate: Promise.resolve(), requests: [], removed: false },
) {
  let historySyncRequests = 0
  await page.route("https://relay.silvermoon.work/**", async (route) => {
    const url = new URL(route.request().url())
    if (!accountState.authenticated && url.pathname !== "/api/logout") {
      await route.fulfill({ status: 401, json: { error: "authentication-required" } })
      return
    }
    const connector = (id: string, displayName: string, status = "online") => ({
      id,
      displayName,
      agent: { name: id === "work" ? "Other Agent" : "GitHub Copilot", version: null },
      capabilities: {
        listSessions: true,
        createSession: true,
        sendMessage: true,
        streamEvents: true,
      },
      status: id === "studio" ? deviceState.status : status,
      removedAt: id === "studio" && workStatus.removed ? "2026-10-12T00:00:00Z" : null,
      connectionId: `${id}-connection-${deviceState.generation}`,
      sessionSyncState: deviceState.generation === deviceState.confirmedGeneration ? "ready" : "pending",
      sessionSyncError: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: null,
      createdAt: "2026-10-10T00:00:00.000Z",
      sessionCount: sessions.filter((session) => session.connectorId === id).length,
    })
    let body: unknown
    if (url.pathname === "/api/me") {
      body = {
        user: { id: accountState.user, displayName: "Reviewer", avatarUrl: null },
        identities: [],
        sessionId: "browser-session",
      }
    } else if (url.pathname === "/api/logout") {
      accountState.authenticated = false
      body = { ok: true }
    } else if (["/api/tokens", "/api/sessions"].includes(url.pathname)) {
      body = []
    } else if (url.pathname === "/api/connectors") {
      body = [
        connector("studio", "Studio laptop"),
        connector("work", "Work desktop"),
        connector("travel", "Travel laptop", "offline"),
      ]
    } else if (url.pathname.endsWith("/work-state")) {
      workStatus.requests.push(url.pathname)
      await workStatus.gate
      if (workStatus.failure) {
        await route.fulfill({ status: 503, json: { error: "Work status could not be saved." } })
        return
      }
      if (workStatus.removed) {
        await route.fulfill({ status: 409, json: { error: "device-removed" } })
        return
      }
      const connectorId = url.pathname.split("/")[3]
      const sessionId = url.pathname.split("/")[5]
      const workState = route.request().postDataJSON().workState
      workStatus.values.set(`${connectorId}:${sessionId}`, workState)
      body = { connectorId, sessionId, workState }
    } else if (url.pathname.endsWith("/events/sync")) {
      historySyncRequests += 1
      body = {
        command: { id: "sync", type: "session.history", status: "sent" },
      }
    } else if (url.pathname === "/api/commands/sync") {
      body = {
        id: "sync",
        connectorId: "studio",
        type: "session.history",
        sessionId: "ended",
        status: historyCommandStatus,
        error: historyCommandStatus === "failed"
          ? { code: "session-not-found", message: "Archived history unavailable." }
          : null,
      }
    } else if (url.pathname.endsWith("/events")) {
      body = url.pathname.includes("/sessions/ended/")
          && url.searchParams.get("after") === "-1"
        ? {
            events: [{
              id: "saved-event",
              sessionId: "ended",
              sequence: 1,
              type: "message",
              role: "assistant",
              text: "Saved activity remains visible.",
              createdAt: "2026-10-09T12:00:00.000Z",
            }],
            nextAfter: 1,
          }
        : { events: [], nextAfter: -1 }
    } else if (url.pathname.endsWith("/sessions")) {
      const connectorId = url.pathname.split("/")[3]
      body = { sessions: sessions
        .filter((session) => session.connectorId === connectorId)
        .map((session) => ({
          ...session,
          workState: workStatus.values.get(`${connectorId}:${session.id}`) ?? "open",
          title: workStatus.titles?.get(session.id) ?? session.title,
          createdAt: session.lastActivityAt,
          updatedAt: session.lastActivityAt,
          lastMessagePreview: `${session.title} preview`,
          canSendMessage: session.status !== "closed",
          nativeStatus: session.status === "closed" ? "65" : null,
          pendingInputRequest: session.id === "signing"
            ? pendingInputRequest
            : null,
          confirmedConnectionId: `${connectorId}-connection-${deviceState.confirmedGeneration}`,
          executionStateKnown: true,
          capabilityConfirmed: true,
        })), nextCursor: null }
    } else {
      throw new Error(
        `Unexpected API request: ${route.request().method()} ${url.pathname}`,
      )
    }
    await route.fulfill({ json: body })
  })
  await page.goto("/")
  await expect(
    page.locator(".session-list").getByText(
      "Confirm signing identity",
      { exact: true },
    ).first(),
  )
    .toBeVisible()
  return () => historySyncRequests
}

const preferencesKey = "silvermoon:session-view-preferences:user"

function workStatusFixture() {
  return {
    values: new Map<string, SessionWorkState>(),
    titles: new Map<string, string>(),
    failure: false, gate: Promise.resolve(), requests: [] as string[], removed: false,
  }
}

async function showCompleted(page: Page) {
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show completed", exact: true }).click()
}

test("detail work state completes and reactivates in place with history, draft and focus preserved", async ({ page }, testInfo) => {
  const state = workStatusFixture()
  await fixture(page, undefined, undefined, undefined, undefined, state)
  await page.locator(".session-item-select").filter({ hasText: "Release desktop client" }).click()
  await page.locator("#session-follow-up").fill("Keep this draft while organizing work")
  const originalUrl = page.url()
  const action = page.locator(".session-work-action.is-detail:visible button")
  await expect(action).toHaveAccessibleName("Mark completed: Release desktop client")
  await action.focus()
  const tooltip = page.locator(".session-work-tooltip:visible")
  await expect(tooltip).toContainText("Does not stop the Agent")
  await page.screenshot({ path: testInfo.outputPath("detail-open.png") })
  await action.press("Enter")
  await expect(action).toHaveAccessibleName("Reactivate: Release desktop client")
  await expect(action).toBeEnabled()
  await expect(action).toBeFocused()
  const actionBounds = await action.boundingBox()
  const noticeBounds = await page.locator(".relay-notice.is-success").boundingBox()
  expect(noticeBounds!.y).toBeGreaterThanOrEqual(actionBounds!.y + actionBounds!.height)
  expect(page.url()).toBe(originalUrl)
  await expect(page.locator("#session-follow-up")).toBeDisabled()
  await expect(page.locator("#session-follow-up")).toHaveValue("Keep this draft while organizing work")
  await expect(page.getByText("This Session is completed in Relay.", { exact: true })).toBeVisible()
  await expect(page.locator(".session-list .session-item-title").filter({ hasText: "Release desktop client" })).toHaveCount(0)
  await expect(page.locator(".session-list .session-item-title").filter({ hasText: "Confirm signing identity" })).toHaveCount(1)
  await action.focus()
  await expect(tooltip).toContainText("Does not send a message")
  await page.screenshot({ path: testInfo.outputPath("detail-completed.png") })
  await action.press("Enter")
  await expect(action).toHaveAccessibleName("Mark completed: Release desktop client")
  await expect(page.locator("#session-follow-up")).toBeEnabled()
  await expect(page.locator("#session-follow-up")).toHaveValue("Keep this draft while organizing work")
  expect(page.url()).toBe(originalUrl)
  expect(state.requests).toHaveLength(2)
  expect(state.values.get("studio:release")).toBe("open")
  await page.reload()
  await expect(action).toHaveAccessibleName("Mark completed: Release desktop client")
  await expect(page.locator("#session-follow-up")).toHaveValue("Keep this draft while organizing work")
})

test("detail work state shares pending and failure feedback with list actions", async ({ page }) => {
  const state = workStatusFixture()
  let release!: () => void
  state.gate = new Promise(resolve => { release = resolve })
  state.failure = true
  await fixture(page, undefined, undefined, undefined, undefined, state)
  await showCompleted(page)
  await page.locator(".session-item-select").filter({ hasText: "Release desktop client" }).click()
  const detail = page.locator(".session-work-action.is-detail:visible button")
  const row = page.locator(".session-list-item").filter({ has: page.locator(".session-item-title", { hasText: "Release desktop client" }) })
  const list = row.locator(".session-work-glyph")
  await detail.click()
  await expect(detail).toBeDisabled()
  await expect(list).toBeDisabled()
  await list.evaluate(button => (button as HTMLButtonElement).click())
  expect(state.requests).toHaveLength(1)
  release()
  await expect(page.getByText("Work status could not be saved.", { exact: true })).toBeVisible()
  await expect(detail).toBeEnabled()
  await expect(list).toBeEnabled()
  await expect(detail).toHaveAccessibleName("Mark completed: Release desktop client")
  await expect(list).toHaveAttribute("aria-label", "Mark completed: Release desktop client")
  await expect(page.getByText(/Marked "Release desktop client" completed/)).toHaveCount(0)
  state.failure = false
  await detail.click()
  await expect(detail).toHaveAccessibleName("Reactivate: Release desktop client")
  await expect(list).toHaveAttribute("aria-label", "Reactivate: Release desktop client")
  const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
  if (await back.isVisible()) await back.click()
  await list.click()
  await expect(list).toHaveAccessibleName("Mark completed: Release desktop client")
  for (const action of await page.locator(".session-work-action.is-detail button").all()) {
    await expect(action).toHaveAttribute("aria-label", "Mark completed: Release desktop client")
  }
  expect(state.requests).toHaveLength(3)
})

test("detail work state completion does not steal focus after navigating to another Session", async ({ page }) => {
  const state = workStatusFixture()
  let release!: () => void
  state.gate = new Promise(resolve => { release = resolve })
  await fixture(page, undefined, undefined, undefined, undefined, state)
  await page.locator(".session-item-select").filter({ hasText: "Release desktop client" }).click()
  await page.locator(".session-work-action.is-detail:visible button").click()
  const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
  if (await back.isVisible()) await back.click()
  await page.locator(".session-item-select").filter({ hasText: "Investigate browser tests" }).click()
  await page.locator("#session-follow-up").fill("Keep focus in this other Session")
  const currentUrl = page.url()
  release()
  await expect(page.locator(".session-work-action.is-detail:visible button")).toBeEnabled()
  await expect(page.locator(".session-work-action.is-detail:visible button")).toHaveAccessibleName("Mark completed: Investigate browser tests")
  await expect(page.locator("#session-follow-up")).toBeFocused()
  await expect(page.locator("#session-follow-up")).toHaveValue("Keep focus in this other Session")
  expect(page.url()).toBe(currentUrl)
  expect(state.requests).toHaveLength(1)
})

test("detail work state Reactivate preserves native archive and read-only history", async ({ page }) => {
  const state = workStatusFixture()
  state.values.set("studio:ended", "completed")
  await fixture(page, undefined, undefined, undefined, undefined, state)
  await showCompleted(page)
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await page.locator(".session-item-select").filter({ hasText: "Completed migration" }).click()
  const action = page.locator(".session-work-action.is-detail:visible button")
  await expect(action).toHaveAccessibleName("Reactivate: Completed migration")
  await expect(page.getByText("Saved activity remains visible.", { exact: true })).toBeVisible()
  await action.click()
  await expect(action).toHaveAccessibleName("Mark completed: Completed migration")
  await expect(page.locator("#session-follow-up")).toBeDisabled()
  await expect(page.getByText("This Session is archived and read-only.", { exact: true })).toBeVisible()
  await expect(page.getByText("Saved activity remains visible.", { exact: true })).toBeVisible()
  expect(state.requests).toHaveLength(1)
})

test("detail work state and list glyphs keep reachable targets with long titles and coarse pointers", async ({ page, browser }, testInfo) => {
  const state = workStatusFixture()
  const title = "A long Session title for checking the deployment and preserving all validation records without losing the action"
  state.titles.set("release", title)
  await fixture(page, undefined, undefined, undefined, undefined, state)
  const list = page.locator(".session-list").getByRole("button", { name: `Mark completed: ${title}`, exact: true })
  const listBounds = await list.boundingBox()
  expect(listBounds).not.toBeNull()
  if (testInfo.project.name !== "desktop") {
    expect(listBounds!.width).toBeGreaterThanOrEqual(44)
    expect(listBounds!.height).toBeGreaterThanOrEqual(44)
  }
  await page.locator(".session-item-select").filter({ hasText: title }).click()
  const detail = page.locator(".session-work-action.is-detail:visible button")
  const bounds = await detail.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  if (testInfo.project.name !== "desktop") {
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
  await detail.focus()
  await expect(page.locator(".session-work-tooltip:visible")).toContainText("Mark completed")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("detail-long-title.png") })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true })
  try {
    const coarse = await context.newPage()
    await fixture(coarse, undefined, undefined, undefined, undefined, state)
    expect(await coarse.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
    for (const surface of [".session-list", ".desktop-session-context"]) {
      const action = coarse.locator(surface).getByRole("button", { name: `Mark completed: ${title}`, exact: true })
      const target = await action.boundingBox()
      expect(target!.width).toBeGreaterThanOrEqual(44)
      expect(target!.height).toBeGreaterThanOrEqual(44)
      expect(await action.evaluate(button => getComputedStyle(button).opacity)).toBe("1")
    }
  } finally {
    await context.close()
  }
})

test("work state glyph completes running work, preserves open children and reactivates without sending", async ({ page }, testInfo) => {
  const state = workStatusFixture()
  await fixture(page, undefined, undefined, undefined, undefined, state)
  const complete = page.locator(".session-list").getByRole("button", { name: "Mark completed: Release desktop client", exact: true })
  await complete.focus()
  await expect(page.locator("#work-state-studio-release")).toBeVisible()
  await expect(page.locator("#work-state-studio-release")).toContainText("Does not stop the Agent")
  const tooltip = await page.locator("#work-state-studio-release").boundingBox()
  expect(tooltip).not.toBeNull()
  expect(tooltip!.x).toBeGreaterThanOrEqual(0)
  expect(tooltip!.y).toBeGreaterThanOrEqual(0)
  expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(tooltip!.y + tooltip!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(await page.locator("#work-state-studio-release").evaluate(el => Boolean(el.closest(".session-list-item")))).toBe(false)
  await page.screenshot({ path: testInfo.outputPath("glyph-open.png") })
  await complete.press("Enter")
  await expect(page.locator(".session-list").getByText("Release desktop client", { exact: true })).toHaveCount(0)
  await expect(page.locator(".session-list").getByText("Confirm signing identity", { exact: true })).toBeVisible()
  await expect(page.locator("#session-follow-up")).toBeDisabled()
  await expect(page.getByText(/Marked "Release desktop client" completed/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Session view options" })).toBeFocused()
  await showCompleted(page)
  const row = page.locator(".session-list-item").filter({ has: page.locator(".session-item-title", { hasText: "Release desktop client" }) })
  await expect(row.locator(".session-work-state")).toHaveText("Completed")
  await expect(row.locator(".session-item-status")).toHaveText("Active")
  await row.getByRole("button", { name: "Reactivate: Release desktop client", exact: true }).focus()
  await page.screenshot({ path: testInfo.outputPath("glyph-completed.png") })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await row.getByRole("button", { name: "Reactivate: Release desktop client", exact: true }).click()
  await expect(complete).toBeVisible()
  await expect(page.locator("#session-follow-up")).toBeEnabled()
  expect(state.requests).toEqual([
    "/api/connectors/studio/sessions/release/work-state",
    "/api/connectors/studio/sessions/release/work-state",
  ])
  await expect(page.locator(".transcript").getByRole("button", { name: /Mark completed|Reactivate/ })).toHaveCount(0)
  await page.reload()
  await expect(complete).toBeVisible()
  await openViewOptions(page)
  await expect(page.getByRole("menuitemcheckbox", { name: "Show completed" })).toHaveAttribute("data-state", "checked")
})

test("work state failures retain the row, block duplicate requests and do not claim success", async ({ page }) => {
  const state = workStatusFixture()
  let release!: () => void
  state.gate = new Promise(resolve => { release = resolve })
  state.failure = true
  await fixture(page, undefined, undefined, undefined, undefined, state)
  const action = page.locator(".session-list").getByRole("button", { name: "Mark completed: Release desktop client", exact: true })
  await action.click()
  await expect(action).toBeDisabled()
  expect(state.requests).toHaveLength(1)
  release()
  await expect(page.getByText("Work status could not be saved.", { exact: true })).toBeVisible()
  await expect(action).toBeEnabled()
  await expect(page.getByText(/Marked "Release desktop client" completed/)).toHaveCount(0)
  expect(state.values.size).toBe(0)
})

test("work state reactivation preserves native archive and saved history", async ({ page }) => {
  const state = workStatusFixture()
  state.values.set("studio:ended", "completed")
  await fixture(page, undefined, undefined, undefined, undefined, state)
  await showCompleted(page)
  await expect(page.locator(".session-list").getByRole("button", { name: "Reactivate: Completed migration" })).toHaveCount(0)
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await page.locator(".session-item-select").filter({ hasText: "Completed migration" }).click()
  await expect(page.getByText("Saved activity remains visible.", { exact: true })).toBeVisible()
  await expect(page.locator("#session-follow-up")).toBeDisabled()
  const opener = page.getByRole("button", { name: "Open Sessions", exact: true })
  if (await opener.isVisible()) await opener.click()
  const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
  if (await back.isVisible()) await back.click()
  await page.locator(".session-list").getByRole("button", { name: "Reactivate: Completed migration", exact: true }).click()
  await expect(page.locator(".session-list").getByText("Completed migration", { exact: true })).toBeVisible()
  await expect(page.locator("#session-follow-up")).toBeDisabled()
  expect(state.values.get("studio:ended")).toBe("open")
})

test("work state is shared across browsers, while glyph actions do not select another Session", async ({ page, browser }) => {
  const state = workStatusFixture()
  await fixture(page, undefined, undefined, undefined, undefined, state)
  await page.locator(".session-item-select").filter({ hasText: "Investigate browser tests" }).click()
  const opener = page.getByRole("button", { name: "Open Sessions", exact: true })
  if (await opener.isVisible()) await opener.click()
  const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
  if (await back.isVisible()) await back.click()
  const previousUrl = page.url()
  await page.locator(".session-list").getByRole("button", { name: "Mark completed: Release desktop client", exact: true }).click()
  await expect(page.getByText(/Marked "Release desktop client" completed/)).toBeVisible()
  expect(page.url()).toBe(previousUrl)
  const context = await browser.newContext()
  try {
    const second = await context.newPage()
    await fixture(second, undefined, undefined, undefined, undefined, state)
    await showCompleted(second)
    await expect(second.locator(".session-list").getByRole("button", { name: "Reactivate: Release desktop client", exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})

test("work state changes work offline but removed Device history has no writable glyph", async ({ page }) => {
  const state = workStatusFixture()
  const device = { status: "online", generation: 1, confirmedGeneration: 1 }
  await fixture(page, undefined, undefined, device, undefined, state)
  device.status = "offline"
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({
    version: 1, showCompleted: true, showEnded: false, showUnavailable: false, showOffline: true, groupByDevice: false,
  })), preferencesKey)
  await page.reload()
  await page.locator(".session-list").getByRole("button", { name: "Mark completed: Release desktop client", exact: true }).click()
  await page.locator(".session-list").getByRole("button", { name: "Reactivate: Release desktop client", exact: true }).click()
  await page.locator(".session-item-select").filter({ hasText: "Release desktop client" }).click()
  await expect(page.locator("#session-follow-up")).toBeVisible()
  await page.locator("#session-follow-up").fill("Keep this local draft")
  const detailAction = page.locator(".session-work-action.is-detail:visible button")
  await detailAction.click()
  await expect(detailAction).toHaveAccessibleName("Reactivate: Release desktop client")
  await detailAction.click()
  await expect(detailAction).toHaveAccessibleName("Mark completed: Release desktop client")
  await expect(page.getByRole("button", { name: "Send follow-up", exact: true })).toBeDisabled()
  state.removed = true
  await page.reload()
  await page.locator(".relay-app").waitFor({ state: "visible" })
  const opener = page.getByRole("button", { name: "Open Sessions", exact: true })
  if (await opener.isVisible()) await opener.click()
  const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
  if (await back.isVisible()) await back.click()
  await expect(page.locator(".session-list").getByText("Release desktop client", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Mark completed: Release desktop client", exact: true })).toHaveCount(0)
  await expect(page.locator(".session-work-action.is-detail button")).toHaveCount(0)
  expect(state.requests).toHaveLength(4)
})

test("work state is not overwritten by an older inventory response", async ({ page }) => {
  const state = workStatusFixture()
  await fixture(page, undefined, undefined, undefined, undefined, state)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let pending = false
  await page.route("**/api/connectors/studio/sessions?*", async route => {
    if (pending) { await route.fallback(); return }
    pending = true
    const snapshot = {
      sessions: sessions.filter(item => item.connectorId === "studio").map(item => ({
        ...item, workState: "open", createdAt: item.lastActivityAt, updatedAt: item.lastActivityAt,
        lastMessagePreview: null, canSendMessage: true, confirmedConnectionId: "studio-connection-1",
        executionStateKnown: true, capabilityConfirmed: true,
      })),
      nextCursor: null,
    }
    await gate
    await route.fulfill({ json: snapshot })
  })
  await expect.poll(() => pending).toBe(true)
  await page.locator(".session-list").getByRole("button", { name: "Mark completed: Release desktop client", exact: true }).click()
  await expect(page.getByText(/Marked "Release desktop client" completed/)).toBeVisible()
  release()
  await expect(page.locator(".session-list").getByText("Release desktop client", { exact: true })).toHaveCount(0)
  await showCompleted(page)
  await expect(page.locator(".session-list").getByRole("button", { name: "Reactivate: Release desktop client", exact: true })).toBeVisible()
})

const preferenceNames = ["Show ended", "Show unavailable", "Show offline Sessions (1)", "Group by Device"]

async function openViewOptions(page: Page) {
  const opener = page.getByRole("button", { name: "Open Sessions", exact: true })
  if (await opener.isVisible()) await opener.click()
  const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
  if (await back.isVisible()) await back.click()
  await page.getByRole("button", { name: "Session view options", exact: true }).click()
}

async function expectViewOptions(page: Page, mask: number) {
  await openViewOptions(page)
  for (const [index, name] of preferenceNames.entries()) {
    await expect(page.getByRole("menuitemcheckbox", {
      name: index === 2 ? /^Show offline Sessions \(/ : name,
      exact: true,
    }))
      .toHaveAttribute("data-state", mask & (1 << index) ? "checked" : "unchecked")
  }
  await page.keyboard.press("Escape")
  const trigger = page.getByRole("button", { name: "Session view options", exact: true })
  if (mask) await expect(trigger).toHaveAttribute("data-active", "true")
  else await expect(trigger).not.toHaveAttribute("data-active")
}

test("all four view option combinations restore after refresh without changing list rules", async ({ page }) => {
  test.setTimeout(120_000)
  await fixture(page)
  await expectViewOptions(page, 0)
  expect(await page.evaluate((key) => localStorage.getItem(key), preferencesKey)).toBeNull()
  for (let mask = 0; mask < 16; mask++) {
    await page.evaluate(({ key, mask }) => localStorage.setItem(key, JSON.stringify({
      version: 1,
      showEnded: Boolean(mask & 1),
      showUnavailable: Boolean(mask & 2),
      showOffline: Boolean(mask & 4),
      groupByDevice: Boolean(mask & 8),
    })), { key: preferencesKey, mask })
    await page.reload()
    await expectViewOptions(page, mask)
    if (mask & 8) {
      await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "true")
      await expect(page.getByRole("button", { name: /Work desktop/ })).toHaveAttribute("aria-expanded", "false")
    } else {
      await expect(page.locator(".session-device-heading")).toHaveCount(0)
      await expect(page.getByText("Unavailable connector work", { exact: true }))
        .toHaveCount(mask & 2 ? 1 : 0)
      await expect(page.getByText("Repair preview deployment", { exact: true }))
        .toHaveCount(mask & 4 ? 1 : 0)
    }
    await expect(page.locator(".session-list").getByText("Release desktop client", { exact: true })).toBeVisible()
    await expect(page.getByText("Completed migration", { exact: true })).toHaveCount(mask & 1 ? 1 : 0)
  }
})

test("menu writes both enabled and disabled preferences and does not persist unrelated view state", async ({ page }, testInfo) => {
  await fixture(page)
  for (const name of preferenceNames) {
    await openViewOptions(page)
    await page.getByRole("menuitemcheckbox", { name, exact: true }).click()
  }
  await expectViewOptions(page, 15)
  await page.getByRole("button", { name: /Studio laptop/ }).click()
  await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "false")
  await page.getByRole("textbox", { name: "Search Sessions, Agents, and Devices" }).fill("Release")
  await page.getByRole("button", { name: "Active 1", exact: true }).click()
  await page.reload()
  await expectViewOptions(page, 15)
  await expect(page.getByRole("textbox", { name: "Search Sessions, Agents, and Devices" })).toHaveValue("")
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "true")
  await page.screenshot({ path: testInfo.outputPath("preferences-restored.png") })
  expect(new URL(page.url()).search).toBe("")
  for (const name of preferenceNames) {
    await openViewOptions(page)
    await page.getByRole("menuitemcheckbox", { name, exact: true }).click()
  }
  await page.reload()
  await expectViewOptions(page, 0)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), preferencesKey))
    .toEqual({ version: 1, showCompleted: false, showEnded: false, showUnavailable: false, showOffline: false, groupByDevice: false })
})

test("offline shortcut saves visibility but not its switch to All", async ({ page }) => {
  await fixture(page)
  await page.getByRole("button", { name: "Active 1", exact: true }).click()
  await page.getByRole("button", { name: "View offline history (switch to All)", exact: true }).click()
  await expectViewOptions(page, 4)
  await page.reload()
  await expectViewOptions(page, 4)
  await expect(page.getByText("Repair preview deployment", { exact: true })).toBeVisible()
})

test("same-account tabs synchronize without affecting filters and other storage", async ({ page, context, browser }) => {
  await fixture(page)
  const second = await context.newPage()
  await fixture(second)
  await second.getByRole("textbox", { name: "Search Sessions, Agents, and Devices" }).fill("Release")
  await second.getByRole("button", { name: "Active 1", exact: true }).click()
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await expectViewOptions(second, 1)
  await expect(second.getByRole("textbox", { name: "Search Sessions, Agents, and Devices" })).toHaveValue("Release")
  await expect(second.getByRole("button", { name: "Active 1", exact: true })).toHaveAttribute("aria-pressed", "true")
  await openViewOptions(second)
  await second.getByRole("menuitemcheckbox", { name: "Group by Device", exact: true }).click()
  await expectViewOptions(page, 9)
  await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("button", { name: /Studio laptop/ }).click()
  await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "false")
  await second.evaluate(() => {
    localStorage.setItem("unrelated", "keep")
    sessionStorage.setItem("silvermoon:session-view-preferences:user", "invalid")
    localStorage.setItem("silvermoon:session-view-preferences:other", "invalid")
  })
  await expectViewOptions(page, 9)
  await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "false")
  const reopened = await context.newPage()
  await fixture(reopened)
  await expectViewOptions(reopened, 9)
  const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const fresh = await isolated.newPage()
    await fixture(fresh)
    await expectViewOptions(fresh, 0)
  } finally {
    await isolated.close()
  }
  await second.evaluate((key) => localStorage.removeItem(key), preferencesKey)
  await expectViewOptions(page, 0)
  expect(await page.evaluate(() => localStorage.getItem("unrelated"))).toBe("keep")
  await second.evaluate((key) => localStorage.setItem(key, "{broken"), preferencesKey)
  await expect(page.getByRole("alert")).toContainText("View preferences could not be restored")
  await second.reload()
  await expectViewOptions(second, 0)
  await openViewOptions(second)
  await second.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await expectViewOptions(page, 1)
  await expect(page.getByRole("alert")).toHaveCount(0)
  await page.evaluate((key) => {
    window.dispatchEvent(new StorageEvent("storage", {
      key, newValue: null, storageArea: localStorage,
    }))
    window.dispatchEvent(new StorageEvent("storage", {
      key, newValue: "{broken", storageArea: sessionStorage,
    }))
  }, preferencesKey)
  await expectViewOptions(page, 1)
  await second.evaluate(() => localStorage.clear())
  await expectViewOptions(page, 0)
})

test("restored grouping expands a visible device when the selected Session is hidden", async ({ page }) => {
  await fixture(page)
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Group by Device", exact: true }).click()
  await page.goto("/?connector=travel&session=preview")
  await expectViewOptions(page, 8)
  await expect(page.getByRole("button", { name: /Studio laptop/ })).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator(".session-list").getByText("Release desktop client", { exact: true })).toBeVisible()
})

test("logout and authentication expiration retain preferences without leaking across accounts", async ({ page, context }) => {
  const state = { authenticated: true, user: "user" }
  const device = { status: "online", generation: 1, confirmedGeneration: 1 }
  await fixture(page, "succeeded", optionInputRequest, device, state)
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await page.getByRole("button", { name: "Account menu for Reviewer", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Sign in or get started" })).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).showEnded, preferencesKey)).toBe(true)
  state.authenticated = true
  state.user = "other"
  await page.reload()
  await expectViewOptions(page, 0)
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show unavailable", exact: true }).click()
  const other = await context.newPage()
  await fixture(other, "succeeded", optionInputRequest, device, state)
  state.user = "user"
  await page.reload()
  await expectViewOptions(page, 1)
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show offline Sessions (1)", exact: true }).click()
  await expectViewOptions(other, 2)
  await page.evaluate(() => window.dispatchEvent(new Event("relay:authentication-required")))
  await expect(page.getByRole("heading", { name: "Sign in or get started" })).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).showOffline, preferencesKey)).toBe(true)
  await page.reload()
  await expectViewOptions(page, 5)
  await other.close()
})

test("invalid records and storage failures warn without blocking the current view", async ({ page, context }, testInfo) => {
  const logs: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") logs.push(message.text())
  })
  await fixture(page)
  await page.evaluate((key) => localStorage.setItem(key, "{broken"), preferencesKey)
  await page.reload()
  await expectViewOptions(page, 0)
  await expect(page.getByRole("alert")).toContainText("View preferences could not be restored")
  await page.getByRole("button", { name: "Dismiss view preferences warning" }).click()
  await expect(page.getByRole("alert")).toHaveCount(0)
  const second = await context.newPage()
  await fixture(second)
  await second.getByRole("button", { name: "Dismiss view preferences warning" }).click()
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("silvermoon:session-view-preferences:")) throw new DOMException("Storage denied", "QuotaExceededError")
      setItem.call(this, key, value)
    }
  })
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await expectViewOptions(page, 1)
  await expect(page.getByText("Completed migration", { exact: true })).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("View preferences could not be saved")
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: testInfo.outputPath("preferences-write-failure.png") })
  await expectViewOptions(second, 0)
  await page.reload()
  await expectViewOptions(page, 0)
  expect(logs.some((message) => message.includes('"event":"session-view-preferences-error"'))).toBe(true)
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", {
    get() { throw new DOMException("Storage denied", "SecurityError") },
  }))
  await page.reload()
  await expectViewOptions(page, 0)
  await expect(page.getByRole("alert")).toContainText("View preferences could not be restored")
  await openViewOptions(page)
  await page.getByRole("menuitemcheckbox", { name: "Show ended", exact: true }).click()
  await expectViewOptions(page, 1)
  await expect(page.getByRole("alert")).toContainText("View preferences could not be saved")
})

test("status views, parent context, and hover disclosure stay coherent", async ({ page }) => {
  await fixture(page)
  await expect(page.getByRole("button", { name: "Active 1" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Needs input 1" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Failed 1" })).toHaveCount(0)
  await expect(page.getByText("Repair preview deployment", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Completed migration", { exact: true }))
    .toHaveCount(0)
  await expect(page.getByText("Unavailable connector work", { exact: true }))
    .toHaveCount(0)

  const parent = page.locator(".session-list-item.has-children").first()
  await expect(parent.locator(".session-state-dot")).toHaveCSS("opacity", "1")
  await expect(parent.locator(".session-tree-toggle")).toHaveCSS("opacity", "0")
  await parent.hover()
  await expect(parent.locator(".session-state-dot")).toHaveCSS("opacity", "0")
  await expect(parent.locator(".session-tree-toggle")).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await expect(parent.locator(".session-state-dot")).toHaveCSS("opacity", "1")
  const collapseButton = parent.getByRole("button", {
    name: "Collapse Release desktop client",
  })

  await collapseButton.focus()
  await expect(parent.locator(".session-tree-toggle")).toHaveCSS("opacity", "1")
  await collapseButton.press("Enter")
  await expect(page.getByText("Confirm signing identity", { exact: true }))
    .toHaveCount(0)
  await parent.getByRole("button", {
    name: "Expand Release desktop client",
  }).press("Enter")
  await expect(page.getByText("Confirm signing identity", { exact: true }))
    .toBeVisible()

  await page.getByRole("textbox", {
    name: "Search Sessions, Agents, and Devices",
  }).fill("signing")
  await expect(page.locator(".session-list-item.is-context")).toContainText(
    "Release desktop client",
  )
  await expect(page.getByText("Confirm signing identity", { exact: true }))
    .toBeVisible()
  await expect(page.locator(".session-list-item.is-subsession")).toHaveCount(1)
})

test("offline history, keyword facets and selected zero states use AND semantics", async ({ page }) => {
  await fixture(page)
  const search = page.getByRole("textbox", { name: "Search Sessions, Agents, and Devices" })
  await search.fill("signing")
  await expect(page.getByRole("button", { name: "Active 1" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Needs input 1" })).toBeVisible()
  await page.getByRole("button", { name: "Needs input 1" }).click()
  await search.fill("Travel")
  await expect(page.getByRole("button", { name: "Needs input 0" })).toBeVisible()
  await expect(search).toHaveValue("Travel")
  await page.getByRole("button", { name: "View offline history (switch to All)" }).click()
  await expect(search).toHaveValue("Travel")
  const offlineRow = page.locator(".session-list-item").filter({ hasText: "Repair preview deployment" })
  await expect(offlineRow).toContainText("Offline")
  await expect(offlineRow).not.toContainText("Failed")
  await page.getByRole("button", { name: "Session view options" }).click()
  await expect(page.getByRole("menuitemcheckbox", { name: "Show offline Sessions (1)" })).toHaveAttribute("data-state", "checked")
  await page.keyboard.press("Escape")
  await search.fill("missing keyword")
  await page.getByRole("button", { name: "Session view options" }).click()
  await expect(page.getByRole("menuitemcheckbox", { name: "Show offline Sessions (0)" })).toBeVisible()
})

test("view options reveal hidden states and focus device groups", async ({ page }) => {
  await fixture(
    page,
    "succeeded",
    optionInputRequest,
    { status: "online", generation: 2, confirmedGeneration: 1 },
  )
  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show ended" }).click()
  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show unavailable" }).click()
  await expect(page.getByText("Completed migration", { exact: true }))
    .toBeVisible()
  await expect(page.getByText("Unavailable connector work", { exact: true }))
    .toBeVisible()

  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Group by Device" }).click()
  const studioGroup = page.getByRole("button", { name: /Studio laptop/ })
  await expect(studioGroup).toHaveCSS("position", "sticky")
  await expect(studioGroup).toHaveCSS("top", "0px")
  await expect(studioGroup.locator(".session-device-status")).toHaveText("online")
  await expect(studioGroup)
    .toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("button", { name: /Work desktop/ }))
    .toHaveAttribute("aria-expanded", "false")
  await expect(page.getByText("Investigate browser tests", { exact: true }))
    .toHaveCount(0)
  await page.getByRole("button", { name: /Studio laptop/ }).click()
  await expect(page.getByRole("button", { name: /Studio laptop/ }))
    .toHaveAttribute("aria-expanded", "false")
  await expect(
    page.locator(".session-list").getByText(
      "Release desktop client",
      { exact: true },
    ),
  ).toHaveCount(0)
  await page.getByRole("button", { name: /Studio laptop/ }).click()
  await page.getByRole("button", { name: /Work desktop/ }).click()
  await expect(page.getByText("Investigate browser tests", { exact: true }))
    .toBeVisible()
  await expect(page.getByRole("button", { name: /Studio laptop/ }))
    .toHaveAttribute("aria-expanded", "true")
})

test("waiting sessions show the original request and selectable options", async ({ page }) => {
  await fixture(page)
  const signing = page.locator(".session-list-item").filter({
    hasText: "Confirm signing identity",
  })
  await expect(signing).toContainText(
    "Choose the certificate that should sign this release.",
  )
  await signing.locator(".session-item-select").click()

  await expect(page.getByText("Agent is waiting for your input")).toBeVisible()
  await expect(page.getByText("Which identity should be used?")).toBeVisible()
  await expect(page.getByText("Recommended")).toBeVisible()
  await expect(page.getByRole("button", {
    name: /Enter custom answer/,
  })).toBeVisible()
  const composer = page.locator(".session-composer")
  const composerFrame = page.locator(".composer-frame")
  await expect(composer.locator(":scope > .pending-input")).toBeVisible()
  await expect(composerFrame.getByRole("textbox", {
    name: "Follow-up message",
  })).toBeVisible()
  await expect(composerFrame.locator(".composer-toolbar")).toBeVisible()
  await expect(composerFrame.getByRole("button", {
    name: "Send follow-up",
  })).toBeVisible()
  await expect(composerFrame.locator(".pending-input")).toHaveCount(0)
  await expect(page.locator(".transcript-shell .pending-input")).toHaveCount(0)
  const options = page.locator(".pending-input-options > button")
  const [firstOption, secondOption] = await Promise.all([
    options.nth(0).boundingBox(),
    options.nth(1).boundingBox(),
  ])
  expect(firstOption).not.toBeNull()
  expect(secondOption).not.toBeNull()
  expect(secondOption!.y).toBeGreaterThan(firstOption!.y)
  expect(secondOption!.x).toBe(firstOption!.x)
  expect(secondOption!.width).toBe(firstOption!.width)
  await page.getByRole("button", { name: /Apple Distribution/ }).click()
  await expect(page.getByRole("textbox", { name: "Follow-up message" }))
    .toHaveValue("Apple Distribution")
  await expect(page.getByRole("textbox", { name: "Follow-up message" }))
    .toBeFocused()
  await page.getByRole("button", { name: /Enter custom answer/ }).click()
  await expect(page.getByRole("textbox", { name: "Follow-up message" }))
    .toHaveValue("")
  await expect(page.getByRole("textbox", { name: "Follow-up message" }))
    .toHaveAttribute("placeholder", /Enter a custom answer/)
  await expect(page.getByRole("textbox", { name: "Follow-up message" }))
    .toBeFocused()
})

test("free-text input requests retain a clear reply entry", async ({ page }) => {
  await fixture(page, "succeeded", {
    id: "input-signing",
    message: "Provide the release note.",
    url: null,
    questions: [{
      id: "release-note",
      kind: "text",
      title: "Release note",
      message: "What should users know about this build?",
      required: true,
    }],
  })
  await page.getByText("Confirm signing identity", { exact: true }).click()
  const pendingInput = page.locator(".pending-input")
  await expect(pendingInput.getByText("Provide the release note.")).toBeVisible()
  await expect(pendingInput.getByText(
    "Enter your answer in the reply box below.",
  ))
    .toBeVisible()
  await expect(page.getByRole("textbox", { name: "Follow-up message" }))
    .toHaveAttribute("placeholder", /Reply to the agent's request/)
})

test("waiting sessions with missing metadata give an honest fallback", async ({ page }) => {
  await fixture(page, "succeeded", null)
  const signing = page.locator(".session-list-item").filter({
    hasText: "Confirm signing identity",
  })
  await expect(signing).toContainText("Input request details unavailable")
  await signing.locator(".session-item-select").click()
  const pendingInput = page.locator(".pending-input")
  await expect(pendingInput.getByText("Input request details unavailable"))
    .toBeVisible()
  await expect(pendingInput.getByText(/older or incomplete Session/))
    .toBeVisible()
  await expect(pendingInput.locator("..").getByRole("textbox", {
    name: "Follow-up message",
  })).toBeVisible()
})

test("input request actions follow offline and current-connection capability confirmation", async ({ page }) => {
  const state = { status: "online", generation: 1, confirmedGeneration: 1 }
  await fixture(page, "succeeded", optionInputRequest, state)
  await page.getByText("Confirm signing identity", { exact: true }).click()
  await expect(page.locator(".pending-input")).toBeVisible()
  await expect(page.getByRole("button", { name: /Apple Distribution/ })).toBeEnabled()
  const draft = page.getByRole("textbox", { name: "Follow-up message" })
  await draft.fill("Draft survives the old input request")
  state.status = "offline"
  await expect(page.locator(".session-connection-notice").getByText("Offline", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.locator(".pending-input")).toHaveCount(0)
  await expect(draft).toBeEnabled()
  await expect(draft).toHaveValue("Draft survives the old input request")
  await expect(page.getByRole("button", { name: "Send follow-up" })).toBeDisabled()
  state.status = "online"
  state.generation = 2
  await expect(page.locator(".session-connection-notice").getByText("Syncing status", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.locator(".pending-input")).toHaveCount(0)
  state.confirmedGeneration = 2
  await expect(page.locator(".pending-input")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: /Apple Distribution/ })).toBeEnabled()
  await expect(draft).toHaveValue("Draft survives the old input request")
})

test("mobile selection and back navigation preserve the list workflow", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile navigation only")
  await fixture(page)
  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show offline Sessions (1)" }).click()
  await page.locator(".session-item-select").filter({
    hasText: "Repair preview deployment",
  }).click()
  await expect(page).toHaveURL(/connector=travel&session=preview/u)
  await expect(page.getByRole("button", { name: "Back to Sessions" }))
    .toBeVisible()
  await page.getByRole("button", { name: "Back to Sessions" }).click()
  await expect(page).not.toHaveURL(/connector=/u)
  await expect(page.getByText("Release desktop client", { exact: true }))
    .toBeVisible()
})

test("archived history stays visible when background sync fails", async ({ page }) => {
  const historySyncRequests = await fixture(page, "failed")
  await page.getByRole("button", { name: "Session view options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show ended" }).click()
  await page.locator(".session-item-select").filter({
    hasText: "Completed migration",
  }).click()

  await expect(page.getByText("Saved activity remains visible.")).toBeVisible()
  await expect(page.getByText("This Session is archived and read-only."))
    .toBeVisible()
  await expect(page.getByText("Archived history unavailable.")).toBeVisible()
  await page.getByRole("button", { name: "Retry sync" }).click()
  await expect.poll(historySyncRequests).toBeGreaterThan(1)
})
