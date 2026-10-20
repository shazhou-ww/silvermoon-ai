import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { FileEventSource, runSync } from "../packages/connector/dist/sync.js";

// Credentials stay on the producer device; never paste them into the Stream browser.
const token = process.env.SILVERMOON_CONNECTION_TOKEN;
if (!token) throw new Error("Set SILVERMOON_CONNECTION_TOKEN using a protected profile or hidden environment prompt.");
const path = resolve(process.env.SILVERMOON_EVENT_SOURCE ?? ".wrangler\\checkout-events.sqlite");
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort());
let source;
try {
  if (process.argv.includes("--init")) {
    await mkdir(dirname(path), { recursive: true });
    source = await FileEventSource.create(path);
  } else source = await FileEventSource.open(path);
  await source.openStream("checkout-observations", "application/vnd.example.checkout-observation.v1+json");
  await source.append("checkout-observations", [JSON.stringify({
    observedAt: new Date().toISOString(), message: "Produced by the checkout-built Node Connector",
  })]);
  console.log("Synchronizing checkout-observations. Keep the SQLite source; Ctrl+C stops safely.");
  await runSync({
    url: process.env.SILVERMOON_SYNC_URL ?? "wss://relay.silvermoon.work/v1/sync",
    token,
    onError: error => console.error(`Synchronization failed (${error.code ?? error.name}); source retained.`),
  }, source, stop.signal);
} finally {
  await source?.close();
}
