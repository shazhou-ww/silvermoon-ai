import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("Cloudflare Pages SPA routing", () => {
  it("leaves Settings to the native SPA fallback without canonical HTML redirects", () => {
    for (const path of ["_redirects", "404.html", "settings.html", "settings/index.html"]) {
      expect(existsSync(new URL(`../public/${path}`, import.meta.url)), path).toBe(false)
    }
  })
})
