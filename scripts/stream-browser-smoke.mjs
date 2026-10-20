import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import wrangler from "wrangler";
import { FileEventSource, SyncClient } from "../packages/connector/dist/sync.js";

const tooling = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = tooling("miniflare");
const webTools = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = webTools("@playwright/test");
const state = resolve(".wrangler", `stream-browser-smoke-${randomUUID()}`);
const pepper = randomBytes(32).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
const account = `browser-${randomUUID()}`;
const device = `device-${randomUUID()}`;
const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");
await mkdir(state, { recursive: true });
let runtime;
let source;
let writer;
let browser;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const relative = path.startsWith("/assets/") ? path.slice(1) : path === "/" || !extname(path) ? "index.html" : path.slice(1);
    const root = resolve("apps", "web", "dist");
    const file = resolve(root, relative);
    if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    response.setHeader("content-type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html" })[extname(file)] ?? "application/octet-stream");
    response.end(data);
  } catch { response.writeHead(404).end(); }
});

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const webOrigin = `http://127.0.0.1:${server.address().port}`;
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port: 0,
    resourcePersistencePath: join(state, "runtime"),
    isolatedResourcePersistencePath: join(state, "isolated"),
    workers: [{
      name: "silvermoon-stream-browser-smoke", modules: true,
      scriptPath: resolve("apps", "worker", "dist", "index.js"),
      compatibilityDate: "2026-10-06", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "00000000-0000-4000-8000-000000000002" },
      durableObjects: {
        DAEMON_SESSIONS: { className: "DaemonSession", useSQLite: true },
        DEVICE_SYNC: { className: "DeviceSync", useSQLite: true },
      },
      bindings: { CONNECTION_TOKEN_PEPPER: pepper, SESSION_SECRET: sessionSecret, AUTH_BASE_URL: "http://127.0.0.1", WEB_ORIGIN: webOrigin },
    }],
  }));
  const address = await runtime.ready;
  assert.equal((await fetch(new URL("/health", address))).status, 200);
  const db = await runtime.getD1Database("DB");
  for (const name of (await readdir(resolve("apps", "worker", "migrations"))).filter(name => name.endsWith(".sql")).sort()) {
    for (const statement of wrangler.unstable_splitSqlQuery(await readFile(resolve("apps", "worker", "migrations", name), "utf8"))) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO users (id,display_name) VALUES (?,'Browser smoke')").bind(account).run();
  await db.prepare("INSERT INTO devices (user_id,id,display_name) VALUES (?,?,'Real Node producer')").bind(account, device).run();
  const tokenId = randomBytes(12).toString("base64url");
  const tokenSecret = randomBytes(32).toString("base64url");
  await db.prepare("INSERT INTO connection_tokens (id,user_id,device_id,secret_hash,token_hint,label) VALUES (?,?,?,?,?,'Local smoke only')")
    .bind(tokenId, account, device, sign(`${tokenId}.${tokenSecret}`, pepper), `smr1_${tokenId}`).run();
  const sessionId = randomBytes(12).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  await db.prepare("INSERT INTO browser_sessions (id,user_id,secret_hash,csrf_hash,expires_at) VALUES (?,?,?,?,?)")
    .bind(sessionId, account, sign(secret, sessionSecret), sign("smoke-csrf", sessionSecret), new Date(Date.now() + 600000).toISOString()).run();
  source = await FileEventSource.create(join(state, "producer.sqlite"));
  await source.openStream("real-node-events", "application/vnd.silvermoon.smoke.v1+json");
  await source.append("real-node-events", ['{"kind":"Node producer → SQLite DO → browser"}', "raw UTF-8 🎉"]);
  writer = new SyncClient({ url: new URL("/v1/sync", address).href.replace(/^http/u, "ws"), token: `smr1_${tokenId}_${tokenSecret}`, role: "writer" });
  await writer.connect();
  await writer.synchronize(source);
  const vite = join(dirname(webTools.resolve("vite/package.json")), "bin", "vite.js");
  await promisify(execFile)(process.execPath, [vite, "build"], {
    cwd: resolve("apps", "web"), env: { ...process.env, VITE_RELAY_ORIGIN: address.origin },
  });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "sm_session", value: `sms1_${sessionId}_${secret}`, url: address.origin, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests = [];
  page.on("request", request => {
    if (request.url().startsWith(address.origin)) {
      assert.ok(!request.headers().authorization, "browser must not use device Bearer credentials");
      requests.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(webOrigin);
  await page.getByRole("button", { name: /real-node-events application/ }).click();
  await page.getByRole("button", { name: "View event 1", exact: true }).waitFor();
  assert.match(await page.locator(".stream-window-status").textContent(), /2 cached/);
  await page.getByRole("button", { name: "View event 1", exact: true }).click();
  assert.match(await page.locator(".event-detail pre").first().textContent(), /Node producer/);
  await page.getByRole("button", { name: "Close raw detail" }).click();
  await page.getByRole("button", { name: "Follow from position" }).click();
  await page.waitForFunction(() => document.querySelector(".stream-range")?.textContent?.includes("· Following"));
  await source.append("real-node-events", ["continuous browser delivery"]);
  await writer.synchronize(source);
  await page.getByRole("button", { name: "View event 3", exact: true }).waitFor();
  assert.ok(await page.locator(".event-row").count() <= 200);
  assert.ok(Number(await page.locator(".stream-events").getAttribute("data-cache-records")) <= 2000);
  assert.ok(Number(await page.locator(".stream-events").getAttribute("data-cache-bytes")) <= 8 * 1024 * 1024);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  writer.close();
  await page.reload();
  await page.getByRole("button", { name: "View event 3", exact: true }).waitFor();
  await page.getByRole("button", { name: "Follow from position" }).click();
  await page.waitForFunction(() => document.querySelector(".stream-range")?.textContent?.includes("· Following"));
  await db.prepare("UPDATE browser_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId).run();
  await page.getByRole("heading", { name: "Sign in or get started" }).waitFor({ timeout: 15000 });
  assert.deepEqual(errors, []);
  assert.ok(!requests.some(path => path.includes("/api/tokens")), "Stream browsing never loads token management");
  console.log("PASS real Node producer → workerd/SQLite DO → cookie-authenticated local browser; historical read, raw detail, continuous append, pause, offline reload, session revocation; DOM≤200, cache≤2000 and≤8MiB. Random local identities and real migrations; no mocked APIs.");
} finally {
  await browser?.close();
  writer?.close();
  await source?.close();
  await runtime?.dispose();
  await new Promise(resolve => server.close(resolve));
  await rm(state, { recursive: true, force: true });
}
