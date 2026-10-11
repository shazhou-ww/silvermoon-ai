import { expect, test, type Page } from "@playwright/test"

async function unauthenticated(page: Page, wait?: Promise<void>) {
  await page.route("https://relay.silvermoon.work/api/me", async (route) => {
    await wait
    await route.fulfill({
      status: 401,
      json: { error: "authentication-required" },
    })
  })
}

test("shows the branded loading state before session discovery", async ({ page }) => {
  let release: (() => void) | undefined
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  await unauthenticated(page, wait)
  await page.goto("/")

  await expect(page.getByRole("status")).toContainText("Opening your relay")
  release?.()
  await expect(page.getByRole("heading", { name: "Sign in or get started" }))
    .toBeVisible()
})

test("presents responsive provider sign-in without obscuring Silvermoon", async ({
  page,
}) => {
  await unauthenticated(page)
  await page.goto("/")

  await expect(page.getByRole("heading", {
    name: "Your agents, within reach from anywhere.",
  })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Sign in or get started" }))
    .toBeVisible()
  await expect(page.locator("[data-provider-icon]")).toHaveCount(3)
  await expect.poll(() =>
    page.locator("[data-provider-icon]")
      .evaluateAll((icons) =>
        icons.every((icon) =>
          icon instanceof HTMLImageElement
          && icon.complete
          && icon.naturalWidth > 0
        )
      )
  ).toBe(true)
  const lineArt = page.getByRole("img", {
    name: "Silvermoon seen from behind, with long hair flowing across the ground",
  })
  if (page.viewportSize()!.width > 760) {
    await expect(lineArt).toBeVisible()
  } else {
    await expect(lineArt).toBeHidden()
  }

  const providers = ["google", "microsoft", "github"] as const
  for (const provider of providers) {
    const label = provider === "github"
      ? "GitHub"
      : `${provider[0].toUpperCase()}${provider.slice(1)}`
    await expect(page.getByRole("link", { name: `Continue with ${label}` }))
      .toHaveAttribute(
        "href",
        `https://relay.silvermoon.work/auth/${provider}/start`,
      )
  }

  const layout = await page.evaluate(() => {
    const login = document.querySelector(".login-card")!.getBoundingClientRect()
    const mascot = document.querySelector(".login-mascot")!
      .getBoundingClientRect()
    const capabilities = document.querySelector(".login-capabilities")!
      .getBoundingClientRect()
    const panel = document.querySelector(".login-page-content")!
      .getBoundingClientRect()
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      loginLeftOfMascot: login.left < mascot.left,
      loginBeforeMascot: login.top < mascot.top,
      overlap: !(
        login.right <= mascot.left
        || login.left >= mascot.right
        || login.bottom <= mascot.top
        || login.top >= mascot.bottom
      ),
      capabilitiesBottom: capabilities.bottom,
      panelCenterOffset: Math.abs(
        (panel.top + panel.bottom) / 2 - window.innerHeight / 2,
      ),
      capabilityPanelGap: panel.bottom - capabilities.bottom,
      loginMascotCenterOffset: Math.abs(
        (login.top + login.bottom) / 2 - (mascot.top + mascot.bottom) / 2,
      ),
      mascotAtLeastAsWideAsLogin: mascot.width >= login.width,
      artDisplay: getComputedStyle(
        document.querySelector(".login-mascot-stage")!,
      ).display,
      horizontalOverflow:
        document.documentElement.scrollWidth
        > document.documentElement.clientWidth,
    }
  })

  expect(layout.horizontalOverflow).toBe(false)
  if (layout.viewportWidth > 900) {
    expect(layout.loginLeftOfMascot).toBe(true)
    expect(layout.overlap).toBe(false)
    expect(layout.panelCenterOffset).toBeLessThanOrEqual(1)
    expect(layout.capabilityPanelGap).toBeGreaterThan(0)
    expect(layout.loginMascotCenterOffset).toBeLessThanOrEqual(64)
    expect(layout.mascotAtLeastAsWideAsLogin).toBe(true)

    for (const width of [1000, 900, 761]) {
      await page.setViewportSize({ width, height: 900 })
      const transition = await page.evaluate(() => {
        const login = document.querySelector(".login-card")!
          .getBoundingClientRect()
        const art = document.querySelector(".login-mascot")!
          .getBoundingClientRect()
        return {
          columns: getComputedStyle(document.querySelector(".login-body")!)
            .gridTemplateColumns.split(" ").length,
          centerOffset: Math.abs(
            (login.top + login.bottom) / 2 - (art.top + art.bottom) / 2,
          ),
          artDisplay: getComputedStyle(
            document.querySelector(".login-mascot-stage")!,
          ).display,
        }
      })
      expect(transition.columns).toBe(2)
      expect(transition.centerOffset).toBeLessThanOrEqual(8)
      expect(transition.artDisplay).not.toBe("none")
    }

    await page.setViewportSize({ width: 760, height: 900 })
    await expect(page.locator(".login-mascot-stage")).toBeHidden()
  } else {
    expect(layout.artDisplay).toBe("none")
  }
})

test("keeps every provider available after an OAuth error", async ({ page }) => {
  await unauthenticated(page)
  await page.goto("/?authError=provider-verification-failed")

  await expect(page.getByRole("alert")).toContainText(
    "We couldn’t verify that sign-in. Try again or choose another provider.",
  )
  await expect(page.getByRole("link", { name: /Continue with/ })).toHaveCount(3)
})
