import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import wrangler from "wrangler";
import { DeviceConnector } from "../packages/connector/dist/duplex.js";
import { FileEventSource, SyncClient } from "../packages/connector/dist/sync.js";

const tooling = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = tooling("miniflare");
const webTools = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = webTools("@playwright/test");
const state = resolve(".wrangler", `device-workspace-smoke-${randomUUID()}`);
const webRoot = join(state, "web");
const evidence = resolve(".wrangler", "device-workspace-evidence");
const account = `account-${randomUUID()}`, foreign = `foreign-${randomUUID()}`;
const pepper = randomBytes(32).toString("base64url"), sessionSecret = randomBytes(32).toString("base64url");
const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");
const execute = promisify(execFile);
const boundedFetch = (url, init = {}) => fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
async function bounded(operation, label, milliseconds = 15_000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
const connectors = [], credentials = [], browserPaths = [], devicePaths = [], pageErrors = [];
let runtime, browser, source, writer, relay, db;
let browserPosts = 0, browserGrants = 0;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = path.startsWith("/assets/") ? path.slice(1) : !extname(path) || path === "/" ? "index.html" : path.slice(1);
    const file = resolve(webRoot, relative);
    if (!file.startsWith(`${webRoot}${sep}`)) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    response.setHeader("content-type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" })[extname(file)] ?? "application/octet-stream");
    response.end(data);
  } catch { response.writeHead(404).end(); }
});

async function seedDevice(owner, name) {
  const id = `device-${randomUUID()}`, tokenId = randomBytes(12).toString("base64url"), secret = randomBytes(32).toString("base64url");
  await db.prepare("INSERT INTO devices(user_id,id,display_name) VALUES (?,?,?)").bind(owner, id, name).run();
  await db.prepare("INSERT INTO connection_tokens(id,user_id,device_id,secret_hash,token_hint,label) VALUES (?,?,?,?,?,'Local fixture')")
    .bind(tokenId, owner, id, sign(`${tokenId}.${secret}`, pepper), `smr1_${tokenId}`).run();
  const credential = `smr1_${tokenId}_${secret}`;
  credentials.push(credential, secret);
  const device = new DeviceConnector({
    relayUrl: relay.origin, accountId: owner, deviceId: id, statePath: join(state, `${id}.sqlite`),
    token: () => credential, timeoutMs: 5000, attempts: 1,
    fetch: (url, init) => { devicePaths.push(new URL(url).pathname); return boundedFetch(url, init); },
  });
  connectors.push(device);
  await device.initialize({ create: true });
  await device.start();
  return { id, name, device, credential };
}

async function seedClient(owner, webOrigin) {
  const id = randomBytes(12).toString("base64url"), secret = randomBytes(32).toString("base64url"), csrf = randomBytes(24).toString("base64url");
  const session = `sms1_${id}_${secret}`;
  await db.prepare("INSERT INTO browser_sessions(id,user_id,secret_hash,csrf_hash,expires_at) VALUES (?,?,?,?,?)")
    .bind(id, owner, sign(secret, sessionSecret), sign(csrf, sessionSecret), new Date(Date.now() + 600_000).toISOString()).run();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(15_000);
  await context.addCookies([
    { name: "sm_session", value: session, url: relay.origin, httpOnly: true, sameSite: "Lax" },
    { name: "sm_csrf", value: csrf, url: webOrigin, sameSite: "Lax" },
  ]);
  await context.route("**/*", route => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (!request.url().startsWith(relay.origin)) return;
    const path = new URL(request.url()).pathname;
    browserPaths.push(path);
    assert.ok(!request.headers().authorization, "browser must not use Device authorization");
    if (request.method() === "POST" && path.endsWith("/regulations")) browserPosts++;
    if (request.method() === "POST" && path.endsWith("/write-access")) browserGrants++;
  });
  const read = async path => {
    const response = await boundedFetch(new URL(`/api/v2/${path}`, relay), { headers: { origin: webOrigin, cookie: `sm_session=${session}` } });
    return { status: response.status, value: await response.json() };
  };
  return { id, context, page, read };
}
async function choose(page, name) {
  const rail = page.getByRole("complementary", { name: "Devices" });
  if (!await rail.isVisible()) await page.getByRole("button", { name: "Back to Devices" }).click();
  await rail.getByRole("button", { name: new RegExp(`^${name}`) }).click();
}
async function send(page, target, payload, optIn) {
  await choose(page, target.name);
  if (await page.getByRole("button", { name: "New request", exact: true }).isVisible()) await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.getByLabel("JSON payload (maximum 16 KiB)", { exact: true }).fill(JSON.stringify(payload));
  if (optIn) {
    await expect(page.getByRole("button", { name: `Send to ${target.name}`, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Enable sending for this session", exact: true }).click();
  }
  await page.getByRole("button", { name: `Send to ${target.name}`, exact: true }).click();
}
async function noDeviceCredentials(page) {
  const html = await page.content();
  for (const credential of credentials) assert.ok(!html.includes(credential), "Device credentials must not appear in page HTML");
}

await mkdir(state, { recursive: true });
await mkdir(evidence, { recursive: true });
async function run() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const webOrigin = `http://127.0.0.1:${server.address().port}`;
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port: 0,
    resourcePersistencePath: join(state, "runtime"), isolatedResourcePersistencePath: join(state, "isolated"),
    workers: [{
      name: "silvermoon-device-workspace-smoke", modules: true,
      scriptPath: resolve("apps", "worker", "dist", "index.js"),
      compatibilityDate: "2026-10-06", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "00000000-0000-4000-8000-000000000003" },
      durableObjects: {
        ACCOUNT_MESSAGES: { className: "AccountMessages", useSQLite: true },
        DEVICE_SYNC: { className: "DeviceSync", useSQLite: true },
        DAEMON_SESSIONS: { className: "DaemonSession", useSQLite: true },
      },
      bindings: { CONNECTION_TOKEN_PEPPER: pepper, SESSION_SECRET: sessionSecret, AUTH_BASE_URL: "http://127.0.0.1", WEB_ORIGIN: webOrigin },
    }],
  }));
  relay = await runtime.ready;
  assert.equal((await boundedFetch(new URL("/health", relay))).status, 200);
  db = await runtime.getD1Database("DB");
  for (const name of (await readdir(resolve("apps", "worker", "migrations"))).filter(name => name.endsWith(".sql")).sort()) {
    for (const sql of wrangler.unstable_splitSqlQuery(await readFile(resolve("apps", "worker", "migrations", name), "utf8"))) await db.prepare(sql).run();
  }
  for (const owner of [account, foreign]) await db.prepare("INSERT INTO users(id,display_name) VALUES (?,'Local workspace reviewer')").bind(owner).run();
  const d1 = await seedDevice(account, "Local workstation"), d2 = await seedDevice(account, "Local laptop");
  const otherDevice = await seedDevice(foreign, "Foreign fixture");
  d1.device.enqueue({ text: "Local uplink one" });
  d2.device.enqueue({ text: "Local uplink two" });
  const [up1] = await d1.device.flush(), [up2] = await d2.device.flush();
  const vite = join(dirname(webTools.resolve("vite/package.json")), "bin", "vite.js");
  // Build exclusively into the operation-owned directory, never overwrite production dist with a local URL.
  await execute(process.execPath, [vite, "build", "--outDir", webRoot], {
    cwd: resolve("apps", "web"), env: { ...process.env, VITE_RELAY_ORIGIN: relay.origin }, timeout: 30_000,
  });
  browser = await chromium.launch();
  const c1 = await seedClient(account, webOrigin), c2 = await seedClient(account, webOrigin), outsider = await seedClient(foreign, webOrigin);
  await Promise.all([c1.page.goto(webOrigin), c2.page.goto(webOrigin), outsider.page.goto(webOrigin)]);
  for (const c of [c1, c2]) for (const up of [up1, up2]) await expect(c.page.getByRole("button", { name: `View Message ${up.id}`, exact: true })).toBeVisible();
  assert.equal(browserGrants, 0, "page load must not grant write access");
  assert.equal(browserPosts, 0);
  await expect(outsider.page.getByRole("button", { name: /^Foreign fixture/ })).toBeVisible();
  assert.equal((await outsider.read(`devices/${d1.id}/messages`)).status, 404);
  assert.equal((await c1.read(`devices/${otherDevice.id}/messages`)).status, 404);
  for (const c of [c1, c2]) for (const d of [d1, d2]) {
    const history = await c.read(`devices/${d.id}/messages`);
    assert.equal(history.status, 200);
    assert.equal(history.value.messages.length, 1);
  }

  let original, lostId, drop = true;
  const regulationRoute = `${relay.origin}/api/v2/devices/${d1.id}/regulations`;
  await c1.page.route(regulationRoute, async route => {
    if (!drop) { await route.continue(); return; }
    drop = false;
    original = route.request().postDataJSON();
    const accepted = await route.fetch({ timeout: 10_000 });
    assert.equal(accepted.status(), 200);
    lostId = (await accepted.json()).id;
    await route.abort("failed");
  });
  await send(c1.page, d1, { text: "Local lost-response request" }, true);
  await expect(c1.page.getByRole("button", { name: "Retry SAME request", exact: true })).toBeEnabled();
  await c1.page.reload();
  await expect(c1.page.locator(".pending-send")).toContainText(original.key);
  await expect(c1.page.locator(".pending-send pre")).toContainText("Local lost-response request");
  assert.equal(browserPosts, 1, "reload cannot automatically resend");
  await c1.page.getByRole("button", { name: "Enable sending for this session", exact: true }).click();
  const retry = c1.page.waitForRequest(request => request.url() === regulationRoute && request.method() === "POST");
  await c1.page.getByRole("button", { name: "Retry SAME request", exact: true }).click();
  assert.deepEqual((await retry).postDataJSON(), original);
  await expect(c1.page.locator(".pending-send [role=status]")).toContainText(`Relay accepted #${lostId}`);
  await send(c1.page, d2, { text: "Client one to Device two" }, false);
  await expect(c1.page.locator(".pending-send [role=status]")).toContainText("Relay accepted");
  await send(c2.page, d1, { text: "Client two to Device one" }, true);
  await expect(c2.page.locator(".pending-send [role=status]")).toContainText("Relay accepted");
  await send(c2.page, d2, { text: "Client two to Device two" }, false);
  await expect(c2.page.locator(".pending-send [role=status]")).toContainText("Relay accepted");
  for (const d of [d1, d2]) {
    const received = await d.device.receive();
    assert.equal(received.length, 2, "2 Clients must each target exactly this Device");
    assert.ok(received.every(message => message.device_id === d.id && !message.is_upstream));
    assert.equal(d.device.state().pending, 2);
    JSON.stringify(d.device.pending());
    assert.equal(d.device.state().pending, 2, "reading/formatting pending work is not ACK");
    assert.deepEqual(await d.device.receive(), received);
  }
  assert.equal((await otherDevice.device.receive()).length, 0);
  for (const c of [c1, c2]) for (const d of [d1, d2]) {
    await choose(c.page, d.name);
    const both = await c.read(`devices/${d.id}/messages`);
    assert.equal(both.value.messages.filter(message => !message.is_upstream).length, 2);
    assert.equal(both.value.messages.filter(message => message.is_upstream).length, 1);
    for (const message of both.value.messages) await expect(c.page.getByRole("button", { name: `View Message ${message.id}`, exact: true })).toBeVisible();
  }
  await choose(c1.page, d1.name);
  d2.device.enqueue({ text: "Other Device uplink while filtered" });
  const [whileFiltered] = await d2.device.flush();
  await expect.poll(async () => c1.page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    return saved.scopes?.["account:up"]?.next ?? "0";
  }, `silvermoon:messages:v2:${encodeURIComponent(account)}`)).toBe(whileFiltered.id);
  for (const c of [c1, c2]) {
    await choose(c.page, "All devices");
    await expect(c.page.getByRole("button", { name: `View Message ${whileFiltered.id}`, exact: true })).toBeVisible();
  }
  assert.deepEqual((await c1.read("account/events")).value.messages, (await c2.read("account/events")).value.messages);
  await choose(c1.page, d1.name);
  await noDeviceCredentials(c1.page);
  await c1.page.screenshot({ path: join(evidence, "local-smoke-desktop.png"), fullPage: true });

  await c2.page.setViewportSize({ width: 390, height: 664 });
  await c2.page.goto(`${webOrigin}/?device=${encodeURIComponent(d2.id)}`);
  await expect(c2.page.getByRole("button", { name: `View Message ${up2.id}`, exact: true })).toBeVisible();
  await expect(c2.page.getByRole("complementary", { name: "Devices" })).toBeHidden();
  await c2.page.getByRole("button", { name: `View Message ${up2.id}`, exact: true }).focus();
  await c2.page.keyboard.press("Enter");
  await expect(c2.page.getByRole("region", { name: `Raw Message ${up2.id}`, exact: true })).toContainText("Local uplink two");
  await c2.page.getByRole("button", { name: "Close raw detail", exact: true }).click();
  await expect(c2.page.getByLabel("Message list", { exact: true })).toBeFocused();
  assert.ok(await c2.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await noDeviceCredentials(c2.page);
  await c2.page.screenshot({ path: join(evidence, "local-smoke-mobile.png"), fullPage: true });
  await c2.page.getByRole("button", { name: "Back to Devices", exact: true }).click();
  await expect(c2.page.getByRole("complementary", { name: "Devices" })).toBeVisible();

  source = await FileEventSource.create(join(state, "legacy-producer.sqlite"));
  await source.openStream("retained-observations");
  await source.append("retained-observations", Array.from({ length: 18 }, (_, i) => `original v1 fixture ${i + 1}`));
  writer = new SyncClient({ url: new URL("/v1/sync", relay).href.replace(/^http/u, "ws"), token: d1.credential, role: "writer" });
  await writer.connect();
  await writer.synchronize(source);
  await c1.page.goto(`${webOrigin}/?device=${encodeURIComponent(d1.id)}&stream=retained-observations&seq=18`);
  await c1.page.getByRole("button", { name: "View event 18", exact: true }).click();
  await expect(c1.page.getByRole("region", { name: "Raw event 18", exact: true })).toContainText("original v1 fixture 18");
  await noDeviceCredentials(c1.page);
  await c2.page.goto(`${webOrigin}/legacy`);
  await expect(c2.page.getByRole("complementary")).toBeVisible();
  await c2.page.goto(`${webOrigin}/settings`);
  await expect(c2.page.getByRole("heading", { name: "Settings", exact: true }).first()).toBeVisible();
  await noDeviceCredentials(c2.page);
  await c1.page.goto(`${webOrigin}/?device=${encodeURIComponent(d1.id)}`);
  await c1.page.getByRole("button", { name: `View Message ${up1.id}`, exact: true }).waitFor();
  await db.prepare("UPDATE browser_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(c1.id).run();
  await c1.page.getByRole("heading", { name: "Sign in or get started", exact: true }).waitFor();
  assert.equal(browserPosts, 5, "four unique submissions and one explicit same-key retry");
  assert.ok(!browserPaths.some(path => path.startsWith("/v2/") || path.endsWith("/ack")), "browser cannot use Device receive/ACK endpoints");
  assert.ok(!devicePaths.some(path => path.endsWith("/ack")), "lib receive/formatting must never emit ACK");
  assert.deepEqual(pageErrors, []);
}
try {
  await bounded(run(), "Local integration smoke", 120_000);
} finally {
  try {
    writer?.close();
    const closed = await bounded(Promise.allSettled([browser?.close(), source?.close(), ...connectors.map(device => device.stop())]), "Client cleanup");
    assert.ok(closed.every(result => result.status === "fulfilled"), "all local clients must close cleanly");
  } finally {
    try { await bounded(runtime?.dispose(), "Runtime cleanup"); }
    finally {
      server.closeAllConnections();
      try { await bounded(new Promise(resolve => server.close(resolve)), "HTTP cleanup", 5000); }
      finally { await rm(state, { recursive: true, force: true }); }
    }
  }
  console.log("PASS local built Devices UI + real workerd/D1/AccountMessages + Device lib: 2 Clients x 2 Devices, foreign Account denial, explicit opt-in, accepted-but-lost response and same-key reload/retry, target-only receive without ACK, all-account reception under filtering, bidirectional history, desktop/mobile keyboard/detail, original v1 seq=18 link, legacy/Settings, session revocation. No mocked HTTP, credentials in page/output, remote writes, or production-dist changes; all owned helpers/state cleaned.");
}
