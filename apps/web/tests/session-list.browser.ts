import { expect, test, type Page } from "@playwright/test"
import type { AgentInputRequest } from "@silvermoon-ai/protocol"

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
) {
  let historySyncRequests = 0
  await page.route("https://relay.silvermoon.work/**", async (route) => {
    const url = new URL(route.request().url())
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
        user: { id: "user", displayName: "Reviewer", avatarUrl: null },
        identities: [],
        sessionId: "browser-session",
      }
    } else if (["/api/tokens", "/api/sessions"].includes(url.pathname)) {
      body = []
    } else if (url.pathname === "/api/connectors") {
      body = [
        connector("studio", "Studio laptop"),
        connector("work", "Work desktop"),
        connector("travel", "Travel laptop", "offline"),
      ]
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
          title: session.title,
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
      "Release desktop client",
      { exact: true },
    ).first(),
  )
    .toBeVisible()
  return () => historySyncRequests
}

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
  await fixture(page)
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
  await signing.getByRole("button", {
    name: /Confirm signing identity/,
  }).click()

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
  await signing.getByRole("button", {
    name: /Confirm signing identity/,
  }).click()
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
