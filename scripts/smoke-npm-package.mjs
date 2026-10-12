import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumer = resolve(process.argv[2]);
const require = createRequire(resolve(consumer, "package.json"));
const connector = await import(pathToFileURL(require.resolve("@silvermoon-ai/connector")).href);
assert.equal(typeof connector.SilvermoonConnector, "function");
assert.equal(typeof connector.CopilotAgentAdapter, "function");
assert.equal(typeof connector.VsCodeAgentHostProvider, "function");
await import(pathToFileURL(require.resolve("@silvermoon-ai/connector/adapter")).href);
const manifest = JSON.parse(await readFile(
  resolve(consumer, "node_modules", "@silvermoon-ai", "connector", "package.json"), "utf8"));
const help = execFileSync(process.execPath, [
  resolve(consumer, "node_modules", "@silvermoon-ai", "connector", manifest.bin["silvermoon-connector"]),
  "--help",
], { encoding: "utf8", cwd: consumer });
assert.match(help, /silvermoon-connector/);
assert.match(help, /--write-config/);
await writeFile(resolve(consumer, "smoke.mts"), `
import { SilvermoonConnector, type SilvermoonConnectorOptions } from "@silvermoon-ai/connector";
import type { AgentAdapter, AgentAdapterEvent } from "@silvermoon-ai/connector/adapter";
export const create = (options: SilvermoonConnectorOptions) => new SilvermoonConnector(options);
export const adapter = (value: AgentAdapter): AgentAdapter => value;
export const event = (value: AgentAdapterEvent): AgentAdapterEvent => value;
`);
execFileSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
  "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext",
  "--target", "ES2022", "--lib", "ES2022,ESNext.Disposable", "--types", "node", "smoke.mts",
], { cwd: consumer, stdio: "inherit" });
console.log("Clean consumer smoke passed: CLI, both runtime exports and public declarations.");
