import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: {
    compilerOptions: {
      rootDir: ".",
    },
    resolve: true,
  },
  entry: {
    adapter: "src/adapter.ts",
    cli: "src/cli.ts",
    index: "src/index.ts",
    sync: "src/sync.ts",
  },
  format: ["esm"],
  noExternal: [
    "@silvermoon-ai/sync-protocol",
    "@silvermoon-ai/protocol",
    "@silvermoon-ai/rpc",
  ],
  platform: "node",
  removeNodeProtocol: false,
  sourcemap: true,
  splitting: true,
  target: "node22",
});
