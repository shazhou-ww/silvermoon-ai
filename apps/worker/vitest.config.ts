import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          DEVICE_MANAGEMENT_SQL: readFileSync(new URL("./migrations/0011_device_management.sql", import.meta.url), "utf8"),
          SESSION_WORK_STATE_SQL: readFileSync(new URL("./migrations/0012_session_work_state.sql", import.meta.url), "utf8"),
          GOOGLE_CLIENT_ID: "google-client",
          GOOGLE_CLIENT_SECRET: "google-secret",
          MICROSOFT_CLIENT_ID: "microsoft-client",
          MICROSOFT_CLIENT_SECRET: "microsoft-secret",
          GITHUB_CLIENT_ID: "github-client",
          GITHUB_CLIENT_SECRET: "github-secret",
          SESSION_SECRET: "test-session-secret-with-sufficient-entropy",
          CONNECTION_TOKEN_PEPPER:
            "test-connection-pepper-with-sufficient-entropy",
        },
      },
    }),
  ],
});
