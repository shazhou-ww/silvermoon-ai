import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: {
    compilerOptions: {
      rootDir: "..",
      baseUrl: ".",
      paths: {
        "@silvermoon-ai/sync-protocol/duplex": ["../sync-protocol/src/duplex.ts"],
      },
    },
    resolve: true,
  },
  entry: {
    adapter: "src/adapter.ts",
    cli: "src/cli.ts",
    index: "src/index.ts",
    sync: "src/sync.ts",
    duplex: "src/duplex.ts",
    "duplex-cli": "src/duplex-cli.ts",
  },
  format: ["esm"],
  noExternal: [
    "@silvermoon-ai/sync-protocol",
    "@silvermoon-ai/sync-protocol/duplex",
    "@silvermoon-ai/protocol",
    "@silvermoon-ai/rpc",
  ],
  platform: "node",
  removeNodeProtocol: false,
  sourcemap: true,
  splitting: true,
  target: "node22",
});
