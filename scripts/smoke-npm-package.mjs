import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumer = resolve(process.argv[2]);
const require = createRequire(resolve(consumer, "package.json"));
const connector = await import(pathToFileURL(require.resolve("@silvermoon-ai/connector")).href);
assert.equal(typeof connector.SilvermoonConnector, "function");
assert.equal(typeof connector.VsCodeAgentHostProvider, "function");
await import(pathToFileURL(require.resolve("@silvermoon-ai/connector/adapter")).href);
const sync = await import(pathToFileURL(require.resolve("@silvermoon-ai/connector/sync")).href);
assert.equal(typeof sync.SyncClient, "function");
assert.equal(typeof sync.FileEventSource, "function");
assert.equal(typeof sync.runSync, "function");
const manifest = JSON.parse(await readFile(
  resolve(consumer, "node_modules", "@silvermoon-ai", "connector", "package.json"), "utf8"));
const help = execFileSync(process.execPath, [
  await realpath(resolve(consumer, "node_modules", "@silvermoon-ai", "connector", manifest.bin["silvermoon-connector"])),
  "--help",
], { encoding: "utf8", cwd: consumer });
assert.match(help, /silvermoon-connector/);
assert.match(help, /--write-config/);
await writeFile(resolve(consumer, "smoke.mts"), `
import { SilvermoonConnector, type SilvermoonConnectorOptions } from "@silvermoon-ai/connector";
import type { AgentAdapter, AgentAdapterEvent } from "@silvermoon-ai/connector/adapter";
import { SyncClient, FileEventSource, type ReliableEventSource, type ServerMessage } from "@silvermoon-ai/connector/sync";
export const create = (options: SilvermoonConnectorOptions) => new SilvermoonConnector(options);
export const adapter = (value: AgentAdapter): AgentAdapter => value;
export const event = (value: AgentAdapterEvent): AgentAdapterEvent => value;
export const source = (value: ReliableEventSource): ReliableEventSource => value;
export const sync = new SyncClient({ url: "ws://127.0.0.1/v1/sync", token: "not-used" });
export const file = FileEventSource.open;
export const message = (value: ServerMessage): ServerMessage => value;
`);
execFileSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
  "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext",
  "--target", "ES2022", "--lib", "ES2022,ESNext.Disposable", "--types", "node", "smoke.mts",
], { cwd: consumer, stdio: "inherit" });
console.log("Clean consumer smoke passed: CLI, AHP and generic sync runtime exports and public declarations.");
