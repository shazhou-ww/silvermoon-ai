import { expect, test, type Page } from "@playwright/test"

async function fixture(page: Page) {
  const state = {
    authenticated: true,
    user: "user",
    createFailure: false,
    createDelay: 0,
    createGate: Promise.resolve(),
    messageDelay: 0,
    messageFailure: false,
    commandStatus: "accepted",
    submitted: "",
    requests: [] as string[],
    created: false,
    events: 40,
    deviceName: "Development Mac",
    removed: false,
    renameFailure: false,
    deleteFailure: false,
    disconnectFailure: false,
    deleteGate: Promise.resolve(),
  }
  await page.route("https://relay.silvermoon.work/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    state.requests.push(`${request.method()} ${path}`)
    if (!state.authenticated && path !== "/api/logout") {
      await route.fulfill({ status: 401, json: { error: "authentication-required" } })
      return
    }
    const token = {
      id: "token",
      deviceId: "one",
      deviceName: "Development Mac",
      tokenHint: "hint",
      createdAt: "2026-10-11T00:00:00.000Z",
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    }
    let body: unknown
    if (path === "/api/me") {
      body = {
        user: { id: state.user, displayName: "Reviewer", avatarUrl: null },
        identities: [{ provider: "github", email: "reviewer@example.test", displayName: "Reviewer", emailVerified: true }],
        sessionId: `browser-${state.user}`,
      }
    } else if (path === "/api/tokens" && request.method() === "POST") {
      await state.createGate
      await new Promise((resolve) => setTimeout(resolve, state.createDelay))
      if (state.createFailure) {
        await route.fulfill({ status: 400, json: { error: "Device creation rejected." } })
        return
      }
      state.created = true
      body = { token: "mock-profile-secret", metadata: token }
    } else if (path === "/api/tokens") {
      body = state.removed ? [] : [token]
    } else if (path === "/api/devices/one/rename") {
      if (state.renameFailure) {
        await route.fulfill({ status: 400, json: { error: "Rename rejected." } })
        return
      }
      state.deviceName = request.postDataJSON().name.trim()
      body = { renamed: true }
    } else if (path === "/api/devices/one" && request.method() === "DELETE") {
      if (state.deleteFailure) {
        await route.fulfill({ status: 503, json: { error: "Deletion unavailable." } })
        return
      }
      await state.deleteGate
      state.removed = true
      body = { removed: true, disconnectRequested: !state.disconnectFailure }
    } else if (path.endsWith("/rotate")) {
      body = { token: "mock-rotated-secret" }
    } else if (path === "/api/connectors") {
      body = ["one", "two", ...(state.created ? ["new"] : [])].map((id) => ({
        id,
        displayName: id === "one" ? state.deviceName : id === "two" ? "Work desktop" : "Created Device",
        agent: { name: "Copilot", version: null },
        capabilities: { listSessions: true, createSession: true, sendMessage: true, streamEvents: true },
        status: id === "one" && state.removed ? "offline" : "online",
        removedAt: id === "one" && state.removed ? "2026-10-12T00:00:00.000Z" : null,
        disconnectRequestedAt: id === "one" && state.removed && !state.disconnectFailure ? "2026-10-12T00:00:00.000Z" : null,
        connectionId: id === "one" && state.removed ? null : `${id}-connection`,
        sessionSyncState: "ready",
        sessionSyncError: null,
        connectedAt: null,
        disconnectedAt: null,
        lastSeenAt: null,
        createdAt: "2026-10-11T00:00:00.000Z",
        sessionCount: 1,
      }))
    } else if (path.endsWith("/events/sync")) {
      body = { synced: true, command: null }
    } else if (path.endsWith("/events")) {
      const after = Number(url.searchParams.get("after"))
      const source = Array.from({ length: state.events }, (_, sequence) => ({
        id: `event-${sequence}`,
        sessionId: "same",
        sequence,
        type: "message",
        role: "assistant",
        text: `${path.includes("/one/") ? "First" : "Second"} message ${sequence}`,
        data: null,
        createdAt: "2026-10-11T00:00:00.000Z",
      }))
      body = { events: source.filter((event) => event.sequence > after), nextAfter: state.events - 1 }
    } else if (path.endsWith("/messages")) {
      state.submitted = path
      await new Promise((resolve) => setTimeout(resolve, state.messageDelay))
      if (state.messageFailure) {
        await route.fulfill({ status: 400, json: { error: "Message request rejected." } })
        return
      }
      body = { command: { id: "receipt", type: "session.message", status: "sent" } }
    } else if (path === "/api/commands/receipt") {
      body = {
        id: "receipt",
        connectorId: state.submitted.includes("/two/") ? "two" : "one",
        sessionId: "same",
        type: "session.message",
        status: state.commandStatus,
        error: state.commandStatus === "failed" ? { code: "failed", message: "Follow-up rejected." } : null,
      }
    } else if (path.endsWith("/sessions")) {
      const id = path.split("/")[3]
      body = [{
        id: "same",
        connectorId: id,
        parentSessionId: null,
        title: id === "one" ? "First Session" : "Second Session",
        status: "idle",
        nativeStatus: null,
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
        lastActivityAt: "2026-10-11T00:00:00.000Z",
        lastMessagePreview: null,
        canSendMessage: true,
        confirmedConnectionId: `${id}-connection`,
        executionStateKnown: true,
        capabilityConfirmed: true,
      }]
    } else if (path === "/api/logout") {
      state.authenticated = false
      body = { ok: true }
    } else {
      throw new Error(`Unexpected request ${request.method()} ${path}`)
    }
    await route.fulfill({ json: body })
  })
  return state
}

const settings = (page: Page) => page.getByRole("region", { name: "Settings", exact: true })
const input = (page: Page) => page.getByRole("textbox", { name: "Follow-up message" })

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Account menu for Reviewer" }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await expect(settings(page)).toBeVisible()
}

async function select(page: Page, title: string) {
  await page.locator(".relay-app").waitFor({ state: "visible" })
  const opener = page.getByRole("button", { name: "Open Sessions", exact: true })
  if (await opener.isVisible()) {
    await opener.click()
  } else {
    const back = page.getByRole("button", { name: "Back to Sessions", exact: true })
    if (await back.isVisible()) await back.click()
  }
  await page.locator(".session-item-select").filter({ hasText: title }).click()
  await expect(input(page)).toBeVisible()
}

test("Settings is a route with two modules and icon-only account controls", async ({ page }) => {
  const state = await fixture(page)
  const response = await page.goto("/settings?connector=one&session=same")
  expect(response?.status()).toBe(200)
  expect(response?.request().redirectedFrom()).toBeNull()
  await expect(page).toHaveURL(/\/settings\?connector=one&session=same$/)
  await expect(settings(page)).toBeVisible()
  await expect(settings(page).getByRole("heading", { name: "Devices", exact: true })).toBeVisible()
  await expect(settings(page).getByRole("heading", { name: "Linked identities" })).toBeVisible()
  await expect(page.getByText("Browser sessions", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Back to Session/ })).toHaveCount(0)
  await expect(settings(page).getByLabel("Device name")).toHaveCount(0)
  await expect(page.locator(".account-trigger")).not.toContainText("Reviewer")
  await page.getByRole("button", { name: "Account menu for Reviewer" }).click()
  await expect(page.getByText("reviewer@example.test", { exact: true }).last()).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible()
  await page.keyboard.press("Escape")
  const link = settings(page).getByRole("link", { name: "Link Google" })
  expect(new URL((await link.getAttribute("href"))!).searchParams.get("returnTo"))
    .toBe("/settings?connector=one&session=same")
  await page.reload()
  await expect(page).toHaveURL(/\/settings\?connector=one&session=same$/)
  await expect(settings(page)).toBeVisible()
  expect(state.requests).not.toContain("GET /api/sessions")
})

test("inline creation shares the device list, cancels without IO and preserves failed input", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/settings")
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  await expect(settings(page).getByLabel("Device name")).toBeFocused()
  await settings(page).getByLabel("Device name").fill("New workstation")
  await expect(page.locator("#create-device").locator("..")).toHaveClass(/settings-list/)
  await settings(page).getByRole("button", { name: "Cancel" }).click()
  await expect(settings(page).getByLabel("Device name")).toHaveCount(0)
  await expect(settings(page).getByRole("button", { name: "Add device", exact: true })).toBeFocused()
  expect(state.requests).not.toContain("POST /api/tokens")
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  await settings(page).getByLabel("Device name").fill("New workstation")
  state.createFailure = true
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Device creation rejected.")
  await expect(settings(page).getByLabel("Device name")).toHaveValue("New workstation")
  state.createFailure = false
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  await expect(settings(page).getByLabel("Device name")).toHaveCount(0)
  await expect(settings(page).getByText("Created Device", { exact: true })).toBeVisible()
  await expect(page.locator(".token-reveal")).toContainText("mock-profile-secret")
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("mock-profile-secret")
})

test("Session drafts are isolated by device and survive Settings and refresh", async ({ page }) => {
  await fixture(page)
  await page.goto("/?connector=one&session=same")
  await input(page).fill("alpha")
  await openSettings(page)
  await expect(page.locator(".session-item-select[aria-current='true']")).toHaveCount(0)
  await select(page, "Second Session")
  await expect(input(page)).toHaveValue("")
  await input(page).fill("beta")
  await select(page, "First Session")
  await expect(input(page)).toHaveValue("alpha")
  await page.reload()
  await expect(input(page)).toHaveValue("alpha")
  await openSettings(page)
  await page.reload()
  await select(page, "Second Session")
  await expect(input(page)).toHaveValue("beta")
})

test("Device rename cancels without IO, retains failed input and updates attribution", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/settings?connector=one&session=same")
  const row = page.locator(".device-settings-row").filter({ hasText: "Development Mac" })
  const rename = row.getByRole("button", { name: "Rename", exact: true })
  await rename.click()
  const dialog = page.getByRole("dialog", { name: "Rename Device" })
  await expect(dialog.getByLabel("Device name")).toBeFocused()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(rename).toBeFocused()
  expect(state.requests).not.toContain("POST /api/devices/one/rename")
  await rename.click()
  await dialog.getByLabel("Device name").fill("Work laptop")
  state.renameFailure = true
  await dialog.getByRole("button", { name: "Save name" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Rename rejected.")
  await expect(dialog.getByLabel("Device name")).toHaveValue("Work laptop")
  state.renameFailure = false
  await dialog.getByRole("button", { name: "Save name" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(settings(page).getByText("Work laptop", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await select(page, "First Session")
  await expect(page.getByRole("region", { name: "Session workspace" })).toContainText("Work laptop")
})

test("Device deletion retains read-only history and exposes persistent disconnect retry", async ({ page, isMobile }) => {
  const state = await fixture(page)
  await page.goto("/settings?connector=one&session=same")
  const row = page.locator(".device-settings-row").filter({ hasText: "Development Mac" })
  await row.getByRole("button", { name: "Delete", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Delete Development Mac?" })
  await expect(dialog).toContainText("does not delete local data, stop local agents")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  expect(state.requests).not.toContain("DELETE /api/devices/one")
  await row.getByRole("button", { name: "Delete", exact: true }).click()
  state.deleteFailure = true
  await dialog.getByRole("button", { name: "Delete device" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Deletion unavailable.")
  await expect(row).toBeVisible()
  state.deleteFailure = false
  state.disconnectFailure = true
  let releaseDelete!: () => void
  state.deleteGate = new Promise<void>(resolve => { releaseDelete = resolve })
  await dialog.getByRole("button", { name: "Delete device" }).click()
  await expect(dialog.locator('button[type="submit"]')).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  releaseDelete()
  await expect(dialog.getByRole("alert")).toContainText("Connection access is disabled")
  expect(state.requests.filter(request => request === "DELETE /api/devices/one")).toHaveLength(2)
  state.deleteGate = Promise.resolve()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(row).toHaveCount(0)
  await page.reload()
  await settings(page).getByRole("button", { name: "Retry disconnect" }).click()
  state.disconnectFailure = false
  await dialog.getByRole("button", { name: "Retry disconnect" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(settings(page).getByRole("button", { name: "Retry disconnect" })).toHaveCount(0)
  await expect(settings(page).getByRole("button", { name: "Add device", exact: true })).toBeFocused()
  if (isMobile) await page.getByRole("button", { name: "Open Sessions" }).click()
  await page.getByRole("button", { name: "New Session", exact: true }).click()
  const createDialog = page.getByRole("dialog", { name: "Start a new Session" })
  await expect(createDialog.getByRole("combobox").getByRole("option", { name: "Development Mac" })).toHaveCount(0)
  await expect(createDialog.getByRole("combobox")).toContainText("Work desktop")
  await createDialog.getByRole("button", { name: "Cancel" }).click()
  await page.goto("/?connector=one&session=same")
  const workspace = page.getByRole("region", { name: "Session workspace" })
  await expect(workspace).toContainText("Device removed")
  await expect(workspace.getByText("First message 39", { exact: true })).toBeVisible()
  await expect(input(page)).not.toBeVisible()
  expect(state.requests.filter(request => request.endsWith("/messages"))).toHaveLength(0)
})

test("Device deletion returns focus to an open Add device form without clearing its draft", async ({ page }) => {
  await fixture(page)
  await page.goto("/settings")
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  const name = settings(page).getByLabel("Device name")
  await name.fill("Next workstation")
  await page.locator(".device-settings-row").filter({ hasText: "Development Mac" })
    .getByRole("button", { name: "Delete", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Delete Development Mac?" })
  await dialog.getByRole("button", { name: "Delete device" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(name).toBeFocused()
  await expect(name).toHaveValue("Next workstation")
})

test("back and forward resolve the right-side destination, and Devices opens its card", async ({ page, isMobile }) => {
  await fixture(page)
  await page.goto("/?connector=one&session=same")
  await expect(input(page)).toBeVisible()
  await openSettings(page)
  await expect(page).toHaveURL(/\/settings\?connector=one&session=same$/)
  await page.goBack()
  await expect(input(page)).toBeVisible()
  await page.goForward()
  await expect(settings(page)).toBeVisible()
  if (isMobile) await page.getByRole("button", { name: "Open Sessions" }).click()
  await page.locator(".session-rail-footer").getByRole("button", { name: "2 Devices" }).click()
  await expect(page).toHaveURL(/\/settings.*#devices$/)
  await expect(page.locator("#settings-devices")).toBeFocused()
})

test("mobile navigation drawer closes on Escape and selects without losing Settings drafts", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile drawer only")
  await fixture(page)
  await page.goto("/settings")
  const opener = page.getByRole("button", { name: "Open Sessions" })
  await opener.click()
  await expect(page.getByRole("dialog", { name: "Sessions" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Sessions" })).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(settings(page)).toBeVisible()
  await select(page, "First Session")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page).toHaveURL(/\/\?connector=one&session=same$/)
})

test("temporary Settings navigation preserves history position and follow intent", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/?connector=one&session=same")
  const region = page.getByRole("region", { name: "Session messages" })
  await expect(page.getByText("First message 39", { exact: true })).toBeVisible()
  const position = await region.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 500
    element.dispatchEvent(new Event("scroll"))
    return element.scrollTop
  })
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible()
  await openSettings(page)
  state.events++
  await select(page, "First Session")
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(position)
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible()
  await page.getByRole("button", { name: "Jump to latest" }).click()
  await openSettings(page)
  state.events++
  await select(page, "First Session")
  await expect.poll(() => region.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1)
})

test("failed receipts preserve source drafts; later success never clears newer edits or another Session", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/?connector=one&session=same")
  await input(page).fill("alpha")
  await page.getByRole("button", { name: "Send follow-up", exact: true }).click()
  await expect(input(page)).toHaveValue("alpha")
  await select(page, "Second Session")
  await input(page).fill("beta")
  state.commandStatus = "failed"
  await expect(page.getByRole("alert")).toContainText("Follow-up rejected.")
  await select(page, "First Session")
  await expect(input(page)).toHaveValue("alpha")
  state.commandStatus = "accepted"
  await page.getByRole("button", { name: "Send follow-up", exact: true }).click()
  await input(page).fill("newer alpha")
  state.commandStatus = "succeeded"
  await expect(page.getByText("Follow-up completed.", { exact: true })).toBeVisible()
  await expect(input(page)).toHaveValue("newer alpha")
  await select(page, "Second Session")
  await expect(input(page)).toHaveValue("beta")
})

test("a late submission receipt clears only its source after navigation and refresh", async ({ page }) => {
  const state = await fixture(page)
  state.messageDelay = 400
  await page.goto("/?connector=one&session=same")
  await input(page).fill("alpha")
  await page.getByRole("button", { name: "Send follow-up", exact: true }).click()
  await openSettings(page)
  await select(page, "Second Session")
  await input(page).fill("beta")
  await expect(page.getByText("Delivering your follow-up...", { exact: true })).toBeVisible()
  await page.reload()
  await expect(input(page)).toHaveValue("beta")
  state.commandStatus = "succeeded"
  await expect(page.getByText("Follow-up completed.", { exact: true })).toBeVisible()
  await expect(input(page)).toHaveValue("beta")
  await select(page, "First Session")
  await expect(input(page)).toHaveValue("")
})

test("profile leaves with Settings and a late token response is never redisplayed", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/settings")
  await settings(page).getByRole("button", { name: "Rotate token" }).click()
  await expect(page.locator(".token-reveal")).toContainText("mock-rotated-secret")
  await select(page, "First Session")
  await openSettings(page)
  await expect(page.locator(".token-reveal")).toHaveCount(0)
  let releaseCreate!: () => void
  state.createGate = new Promise<void>(resolve => { releaseCreate = resolve })
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  await select(page, "First Session")
  releaseCreate()
  await expect(page.getByText(/Device created\. Return to Settings/)).toBeVisible()
  await openSettings(page)
  await expect(page.locator(".token-reveal")).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("secret")
})

test("storage denial is explicit and logout clears only this account's drafts", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/?connector=one&session=same")
  await input(page).fill("private draft")
  await page.evaluate(() => sessionStorage.setItem("unrelated", "keep"))
  await page.getByRole("button", { name: "Account menu for Reviewer" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Sign in or get started" })).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("private draft")
  expect(await page.evaluate(() => sessionStorage.getItem("unrelated"))).toBe("keep")
  state.authenticated = true
  state.user = "different-user"
  await page.reload()
  await select(page, "First Session")
  await expect(input(page)).toHaveValue("")
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage denied", "QuotaExceededError") }
  })
  await input(page).fill("still editable")
  await expect(input(page)).toHaveValue("still editable")
  await expect(page.getByRole("alert")).toContainText("Drafts could not be cached")
})

test("authentication expiration removes drafts and does not restore a late profile", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/?connector=one&session=same")
  await input(page).fill("private draft")
  state.authenticated = false
  await expect(page.getByRole("heading", { name: "Sign in or get started" })).toBeVisible({ timeout: 8_000 })
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("private draft")
})

test("message request failures preserve input and an uncertain refresh never resends", async ({ page }) => {
  const state = await fixture(page)
  state.messageFailure = true
  await page.goto("/?connector=one&session=same")
  await input(page).fill("alpha")
  await page.getByRole("button", { name: "Send follow-up", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Message request rejected.")
  await expect(input(page)).toHaveValue("alpha")
  state.messageFailure = false
  state.messageDelay = 800
  await page.getByRole("button", { name: "Send follow-up", exact: true }).click()
  await expect.poll(() => state.requests.filter((request) => request.endsWith("/messages")).length).toBe(2)
  await page.reload()
  await expect(input(page)).toHaveValue("alpha")
  await expect(page.getByText(/Delivery could not be confirmed after refreshing/)).toBeVisible()
  expect(state.requests.filter((request) => request.endsWith("/messages")).length).toBe(2)
})

test("layout stays single-column with aligned creation rows at every tested width", async ({ page, isMobile }, testInfo) => {
  await fixture(page)
  await page.goto("/settings")
  await expect(settings(page)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("settings.png") })
  await settings(page).getByRole("button", { name: "Add device", exact: true }).click()
  const layout = await page.evaluate(() => {
    const create = document.querySelector("#create-device")!
    const row = document.querySelector(".device-settings-row")!
    const first = create.getBoundingClientRect()
    const second = row.getBoundingClientRect()
    const cards = Array.from(document.querySelectorAll(".settings-page .settings-card")).map((card) => card.getBoundingClientRect())
    const style = getComputedStyle(create)
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      columns: getComputedStyle(document.querySelector(".settings-page")!).gridTemplateColumns.split(" ").length,
      sameParent: create.parentElement === row.parentElement,
      sameLeft: Math.abs(first.left - second.left) < 1,
      sameWidth: Math.abs(first.width - second.width) < 1,
      stacked: cards[0].bottom <= cards[1].top,
      noPanel: style.borderLeftWidth === "0px" && style.borderRightWidth === "0px" && style.borderRadius === "0px",
      createGrid: style.display === "grid",
      deviceGrid: getComputedStyle(row).display === "grid",
    }
  })
  expect(layout).toEqual({ overflow: false, columns: 1, sameParent: true, sameLeft: true, sameWidth: true, stacked: true, noPanel: true, createGrid: true, deviceGrid: true })
  await page.screenshot({ path: testInfo.outputPath("settings-create.png") })
  if (isMobile) {
    await page.getByRole("button", { name: "Open Sessions", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Sessions", exact: true })).toBeVisible()
    const drawerLayout = await page.getByRole("dialog", { name: "Sessions", exact: true }).evaluate((drawer) => {
      const container = drawer.getBoundingClientRect()
      const rail = drawer.querySelector(".session-rail")!.getBoundingClientRect()
      return { topGap: rail.top - container.top, leftGap: rail.left - container.left }
    })
    expect(drawerLayout.topGap).toBeLessThanOrEqual(2)
    expect(drawerLayout.leftGap).toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath("settings-drawer.png") })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Open Sessions", exact: true })).toBeFocused()
  }
})

test("signed-out Settings keeps its login return destination and invalid routes are explicit", async ({ page }) => {
  const state = await fixture(page)
  state.authenticated = false
  await page.goto("/settings")
  await expect(page.getByRole("heading", { name: "Sign in or get started" })).toBeVisible()
  const href = await page.getByRole("link", { name: "Continue with GitHub" }).getAttribute("href")
  expect(new URL(href!).searchParams.get("returnTo")).toBe("/settings")
  state.authenticated = true
  await page.goto("/not-a-page")
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()
  await page.getByRole("button", { name: "Open Sessions", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
})
