import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import wrangler from "wrangler";
import { DeviceConnector } from "../packages/connector/dist/duplex.js";
import { durablyReceive } from "../packages/connector/examples/duplex-host.mjs";

const tooling = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = tooling("miniflare");
const state = resolve(".wrangler", `duplex-smoke-${crypto.randomUUID()}`);
const pepper = randomBytes(32).toString("base64url"), sessionSecret = randomBytes(32).toString("base64url");
const clients = new Set(), checks = [];
let runtime, host;
let address;
let fixedPort = 0;
const sign = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");
const execute = promisify(execFile);

async function start() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port: fixedPort,
    resourcePersistencePath: join(state, "runtime"), isolatedResourcePersistencePath: join(state, "isolated"),
    workers: [{
      name: "silvermoon-duplex-smoke", modules: true,
      scriptPath: resolve("apps", "worker", "dist", "index.js"),
      compatibilityDate: "2026-10-06", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "00000000-0000-4000-8000-000000000001" },
      durableObjects: {
        DAEMON_SESSIONS: { className: "DaemonSession", useSQLite: true },
        DEVICE_SYNC: { className: "DeviceSync", useSQLite: true },
        ACCOUNT_MESSAGES: { className: "AccountMessages", useSQLite: true },
      },
      bindings: { CONNECTION_TOKEN_PEPPER: pepper, SESSION_SECRET: sessionSecret,
        AUTH_BASE_URL: "http://localhost", WEB_ORIGIN: "http://localhost" },
    }],
  }));
  address = await runtime.ready;
  fixedPort = Number(address.port);
  assert.equal((await fetch(new URL("/health", address))).status, 200);
}
async function token(db, account, device) {
  const id = randomBytes(12).toString("base64url"), secret = randomBytes(32).toString("base64url");
  await db.prepare("INSERT OR IGNORE INTO users(id,display_name) VALUES (?,'Duplex local smoke')")
    .bind(account).run();
  await db.prepare("INSERT OR IGNORE INTO devices(user_id,id,display_name) VALUES (?,?,'Smoke device')")
    .bind(account, device).run();
  await db.prepare("INSERT INTO connection_tokens(id,user_id,device_id,secret_hash,token_hint,label) VALUES (?,?,?,?,?,'Smoke only')")
    .bind(id, account, device, sign(`${id}.${secret}`, pepper), `smr1_${id}`).run();
  return `smr1_${id}_${secret}`;
}
async function browser(db, account) {
  const id = randomBytes(12).toString("base64url"), secret = randomBytes(32).toString("base64url"), csrf = randomBytes(24).toString("base64url");
  await db.prepare("INSERT INTO browser_sessions(id,user_id,secret_hash,csrf_hash,expires_at) VALUES (?,?,?,?,?)")
    .bind(id, account, sign(secret, sessionSecret), sign(csrf, sessionSecret), new Date(Date.now() + 3600_000).toISOString()).run();
  const headers = { cookie: `sm_session=sms1_${id}_${secret}; sm_csrf=${csrf}`,
    "x-csrf-token": csrf, origin: "http://localhost", "content-type": "application/json" };
  const request = async (path, input) => {
    const response = await fetch(new URL(`/api/v2/${path}`, address), {
      headers, method: input ? "POST" : "GET", ...(input ? { body: JSON.stringify(input) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  await request("account/write-access", { enabled: true });
  return request;
}
async function device(deviceId, credential, create, customFetch = fetch) {
  const connector = new DeviceConnector({ relayUrl: address.origin, accountId: "account", deviceId,
    statePath: join(state, `${deviceId}.sqlite`), token: credential, fetch: customFetch, attempts: 2 });
  await connector.initialize({ create });
  clients.add(connector);
  await connector.start();
  return connector;
}

try {
  await mkdir(state, { recursive: true });
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `
    globalThis.fetch=()=>{throw Error("import network")};
    console.log=console.error=()=>{throw Error("import output")};
    process.on=process.once=process.exit=()=>{throw Error("import lifecycle")};
    const { DeviceConnector } = await import("@silvermoon-ai/connector/duplex");
    new DeviceConnector({relayUrl:"https://example.invalid",accountId:"a",deviceId:"d",
      statePath:"must-not-open",token:()=>{throw Error("constructor credential read")}});
    await import(${JSON.stringify(new URL("../packages/connector/dist/duplex-cli.js", import.meta.url).href)});
  `], { encoding: "utf8", cwd: resolve("packages", "connector") });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  for (const file of (await readdir(resolve("packages", "connector", "dist"))).filter(n => /\.(?:js|ts)$/u.test(n))) {
    assert.doesNotMatch(await readFile(resolve("packages", "connector", "dist", file), "utf8"),
      /(?:from\s*|import\s*\(|require\s*\()\s*["']@silvermoon-ai\/(?:protocol|rpc|sync-protocol)(?:["'/])/u);
  }
  const publicTypes = join(state, "public-api.mts");
  await writeFile(publicTypes, `
    import { DeviceConnector, type DeviceConnectorOptions, type Message } from "../../packages/connector/dist/duplex.js";
    export const create = (options: DeviceConnectorOptions) => new DeviceConnector(options);
    export const receipt = (message: Message) => message.payload;
    export const enqueue = (device: DeviceConnector) => device.enqueue({generic:"host"}, "host-stable-request-key");
    export const flush = (device: DeviceConnector) => device.flush(1);
  `);
  await execute(process.execPath, [resolve("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict",
    "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022",
    "--lib", "ES2022,ESNext.Disposable", "--typeRoots", resolve("packages", "connector", "node_modules", "@types"),
    "--types", "node", publicTypes]);
  checks.push("built library and CLI imports have no network, logging or process-lifecycle side effects");
  checks.push("public package export, portable bundled declarations, arbitrary host request keys and bounded flush typing");
  await start();
  let db = await runtime.getD1Database("DB");
  for (const name of (await readdir(resolve("apps", "worker", "migrations"))).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of wrangler.unstable_splitSqlQuery(await readFile(resolve("apps", "worker", "migrations", name), "utf8"))) {
      await db.prepare(statement).run();
    }
  }
  let credential1 = await token(db, "account", "d1");
  const credential2 = await token(db, "account", "d2");
  const [c1, c2] = await Promise.all([browser(db, "account"), browser(db, "account")]);
  let drop = true;
  const lossyFetch = async (url, init) => {
    const response = await fetch(url, init);
    if (drop && String(url).endsWith("/events") && response.ok) {
      drop = false;
      await response.arrayBuffer();
      throw new Error("injected lost acceptance");
    }
    return response;
  };
  let d1 = await device("d1", () => credential1, true, lossyFetch);
  let d2 = await device("d2", () => credential2, true);
  for (const c of [c1, c2]) for (const d of ["d1", "d2"]) {
    await c(`devices/${d}/regulations`, { key: crypto.randomUUID(), payload: { target: d } });
  }
  assert.equal((await d1.receive()).length, 2);
  assert.equal((await d2.receive()).length, 2);
  assert.equal(d1.state().pending, 2);
  host = new DatabaseSync(join(state, "host.sqlite"));
  host.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  d1.enqueue({ event: "autonomous d1" });
  d2.enqueue({ event: "autonomous d2" });
  await Promise.all([d1.flush(), d2.flush()]);
  const [events1, events2] = await Promise.all([c1("account/events"), c2("account/events")]);
  assert.deepEqual(events1, events2);
  assert.equal(events1.messages.length, 2);
  checks.push("real public library, 2 Devices x 2 Clients target routing, broadcast and lost-HTTP-response deduplication");
  await d1.stop(); clients.delete(d1);
  await d2.stop(); clients.delete(d2);
  await runtime.dispose(); runtime = undefined;
  await start();
  db = await runtime.getD1Database("DB");
  credential1 = await token(db, "account", "d1");
  d1 = await device("d1", () => credential1, false);
  d2 = await device("d2", () => credential2, false);
  assert.equal(d1.state().accepted, 1);
  assert.equal(d1.state().pending, 2);
  assert.equal((await d1.receive()).length, 2);
  assert.equal(await durablyReceive(d1, host), 2);
  assert.equal(await durablyReceive(d2, host), 2);
  assert.equal(host.prepare("SELECT COUNT(*) AS n FROM host_receipts").get().n, 4);
  assert.equal(d1.state().pending, 0);
  assert.equal((await c1("account/events")).messages.length, 2);
  const credential3 = await token(db, "account", "d3");
  const d3 = await device("d3", () => credential3, true);
  const waiting = [c1, c2].map(c => c(`account/events?after=${events1.next}&wait=2000`));
  d3.enqueue({ event: "new device after runtime restart" });
  await d3.flush();
  for (const page of await Promise.all(waiting)) assert.equal(page.messages[0].device_id, "d3");
  checks.push("full runtime/local SQLite restart, token rotation, durable host receipt ACK and automatic new-Device inclusion");
  const cliToken = await token(db, "account", "cli-device");
  const cliConfig = join(state, "cli.json"), tokenFile = join(state, "cli.token");
  await writeFile(tokenFile, cliToken, { mode: 0o600 });
  await writeFile(cliConfig, JSON.stringify({ relayUrl: address.origin, accountId: "account", deviceId: "cli-device",
    statePath: join(state, "cli.sqlite"), tokenFile }), { mode: 0o600 });
  const cli = async (command, value) => {
    const result = await execute(process.execPath, [resolve("packages", "connector", "dist", "duplex-cli.js"), command, cliConfig,
      ...(value === undefined ? [] : [value])], { timeout: 30_000 });
    const lines = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.ok(!result.stderr.includes(cliToken));
    return lines[0];
  };
  assert.equal((await cli("init")).queued, 0);
  assert.equal((await cli("enqueue", JSON.stringify({ from: "cli" }))).status, "queued");
  assert.equal((await cli("flush"))[0].status, "accepted");
  const regulation = await c1("devices/cli-device/regulations", { key: crypto.randomUUID(), payload: "observe without ACK" });
  assert.equal((await cli("receive"))[0].id, regulation.id);
  assert.equal((await cli("state")).pending, 1);
  await cli("ack", regulation.id);
  assert.equal((await cli("state")).pending, 0);
  await assert.rejects(cli("not-a-command"), error => {
    assert.equal(error.stdout, "");
    const diagnostic = error.stderr.split("\n").find(line => line.startsWith("{"));
    assert.ok(JSON.parse(diagnostic).error);
    return error.code === 1;
  });
  checks.push("actual thin CLI init/enqueue/flush/receive/state/ack, JSONL-only stdout, explicit nonzero diagnostic failure and no print-as-ACK");
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  for (const client of clients) await client.stop().catch(() => {});
  host?.close();
  await runtime?.dispose();
  await rm(state, { recursive: true, force: true });
}
