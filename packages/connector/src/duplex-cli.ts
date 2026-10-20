#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DeviceConnector, DuplexError, type DeviceConnectorOptions } from "./duplex.js";

export async function runDuplexCommand(
  connector: DeviceConnector, command: string, value?: string,
): Promise<unknown> {
  switch (command) {
    case "state": return connector.state();
    case "enqueue": return connector.enqueue(JSON.parse(value ?? "null"));
    case "send": {
      const queued = connector.enqueue(JSON.parse(value ?? "null"));
      await connector.start();
      return { queued, accepted: await connector.flush() };
    }
    case "flush": await connector.start(); return connector.flush();
    case "receive": await connector.start(); return connector.receive(20_000);
    case "ack": await connector.start(); await connector.acknowledge(value ?? ""); return { acknowledged: value };
    default: throw new DuplexError("unknown_command");
  }
}

export async function duplexMain(args: string[], io: { out: (line: string) => void; error: (line: string) => void }): Promise<number> {
  let connector: DeviceConnector | undefined;
  let code = 0;
  try {
    const [command, configPath, value] = args;
    if (!command || !configPath || args.length > 3) throw new DuplexError("usage: <init|state|enqueue|send|flush|receive|ack> <config.json> [json-payload|message-id]");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Omit<DeviceConnectorOptions, "token"> & { tokenFile: string };
    connector = new DeviceConnector({ ...config, token: async () => (await readFile(config.tokenFile, "utf8")).trim() });
    await connector.initialize({ create: command === "init" });
    const result = command === "init" ? connector.state() : await runDuplexCommand(connector, command, value);
    io.out(JSON.stringify(result));
  } catch (error) {
    io.error(JSON.stringify({ error: error instanceof DuplexError ? error.code : "command_failed" }));
    code = 1;
  } finally {
    try { await connector?.stop(); }
    catch { io.error(JSON.stringify({ error: "stop_failed" })); code = 1; }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await duplexMain(process.argv.slice(2), {
    out: line => process.stdout.write(`${line}\n`),
    error: line => process.stderr.write(`${line}\n`),
  });
}
