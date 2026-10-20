import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { registry, registryMetadata, releasePlan, requireUnpublished,
  validatePackManifest, verifyPack, verifyPublished } from "./npm-release.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../packages/connector/package.json", import.meta.url), "utf8"));
const candidate = { ...manifest, version: "1.2.3" };
const plan = releasePlan("npm/connector/v1.2.3", candidate);

test("stable and named prerelease tags derive explicit npm channels", () => {
  assert.deepEqual(plan, { packageName: candidate.name, packageDirectory: "packages/connector",
    version: "1.2.3", distTag: "latest" });
  for (const [version, distTag] of [["1.2.3-rc.1", "rc"], ["1.2.3-beta.0", "beta"],
    ["1.2.3-canary.42.g0123456789ab", "canary"]]) {
    assert.equal(releasePlan(`npm/connector/v${version}`, { ...candidate, version }).distTag, distTag);
  }
});

test("malformed, unknown, legacy and noncanonical tags fail", () => {
  for (const tag of ["v1.2.3", "@silvermoon-ai/connector@1.2.3", "npm/unknown/v1.2.3",
    "npm/connector/1.2.3", "npm/connector/v01.2.3", "npm/connector/v1.2", "npm/connector/v1.2.3\n",
    "npm/connector/v1.2.3+build.1", "npm/connector/v1.2.3-rc.01", "npm/connector/v1.2.3-1",
    "npm/connector/v1.2.3-latest.1", "npm/connector/v1.2.3-LATEST.1",
    "npm/connector/v1.2.3-rc..1", "npm/connector/v1.2.3-rc/1",
    "npm/connector/v9007199254740992.2.3", "npm/connector/v1.2.3-rc.9007199254740992"]) {
    assert.throws(() => releasePlan(tag, candidate), undefined, tag);
  }
});

test("manifest identity, version, access and registry are authoritative", () => {
  for (const change of [{ name: "@silvermoon-ai/rpc" }, { private: true }, { version: "1.2.4" },
    { publishConfig: { access: "restricted", registry } },
    { publishConfig: { access: "public", registry: "https://example.com/" } }]) {
    assert.throws(() => releasePlan("npm/connector/v1.2.3", { ...candidate, ...change }));
  }
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const dependency of [{ "@silvermoon-ai/protocol": "1.0.0" },
      { "@silvermoon-ai/rpc": "workspace:*" }, { "@silvermoon-ai/sync-protocol": "1.0.0" }, { external: "file:../external" },
      { external: "link:../external" }]) {
      assert.throws(() => releasePlan("npm/connector/v1.2.3", { ...candidate, [field]: dependency }));
    }
  }
});

test("registry preflight distinguishes 404, duplicates and explicit errors", async () => {
  assert.equal(await registryMetadata(async () => new Response("", { status: 404 })), null);
  requireUnpublished(plan, null);
  requireUnpublished(plan, { versions: {} });
  assert.throws(() => requireUnpublished(plan, { versions: { "1.2.3": candidate } }), /already exists/);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(registryMetadata(async () => new Response("", { status })), /refusing/);
  }
  await assert.rejects(registryMetadata(async () => { throw new Error("network unavailable"); }), /network/);
  await assert.rejects(registryMetadata(async () => Response.json({ name: candidate.name })), /metadata/);
  await assert.rejects(registryMetadata(async () => Response.json({ name: "wrong", versions: {} })), /identity/);
});

test("packed manifest keeps both CLIs and all four runtime/type exports", () => {
  validatePackManifest(plan, candidate);
  assert.throws(() => validatePackManifest(plan, { ...candidate, exports: {} }));
  assert.throws(() => validatePackManifest(plan, { ...candidate, bin: {} }));
  assert.throws(() => validatePackManifest(plan, { ...candidate, version: "1.2.4" }));
});

test("tarball checks validate actual bytes, entrypoints and inlined private dependencies", async () => {
  const directory = resolve(".wrangler", `silvermoon-npm-pack-test-${crypto.randomUUID()}`);
  try {
    const files = {
      "package.json": JSON.stringify(candidate),
      "README.md": "Connector",
      "dist/cli.js": "#!/usr/bin/env node\n",
      "dist/index.js": "export {};",
      "dist/index.d.ts": "export {};",
      "dist/adapter.js": "export {};",
      "dist/adapter.d.ts": "export {};",
      "dist/sync.js": "export {};",
      "dist/sync.d.ts": "export {};",
      "dist/duplex.js": "export {};",
      "dist/duplex.d.ts": "export {};",
      "dist/duplex-cli.js": "#!/usr/bin/env node\n",
    };
    await mkdir(join(directory, "package", "dist"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(directory, "package", name), content);
    }
    let packedFiles = Object.keys(files);
    const pack = async () => {
      const filename = "candidate.tgz";
      execFileSync("tar", ["-czf", join(directory, filename), "-C", directory,
        ...packedFiles.map((file) => `package/${file}`)]);
      const bytes = await readFile(join(directory, filename));
      return [{ name: plan.packageName, version: plan.version, filename,
        shasum: createHash("sha1").update(bytes).digest("hex"),
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` }];
    };
    const [record] = await pack();
    const bytes = await readFile(join(directory, "candidate.tgz"));
    assert.equal((await verifyPack(plan, [record], directory)).sha256,
      createHash("sha256").update(bytes).digest("hex"));
    await assert.rejects(verifyPack(plan, [], directory), /Exactly one/);
    await assert.rejects(verifyPack(plan, [{ ...record, version: "1.2.4" }], directory));
    await assert.rejects(verifyPack(plan, [{ ...record, shasum: "wrong" }], directory));
    await assert.rejects(verifyPack(plan, [{ ...record, integrity: "wrong" }], directory));
    await assert.rejects(verifyPack(plan, [{ ...record, filename: "../candidate.tgz" }], directory), /escape/);
    for (const file of ["dist/index.js", "dist/index.d.ts", "dist/sync.js", "dist/sync.d.ts",
      "dist/duplex.js", "dist/duplex.d.ts", "dist/duplex-cli.js"]) {
      for (const name of ["protocol", "rpc", "sync-protocol"]) {
        await writeFile(join(directory, "package", file),
          `${file.endsWith("cli.js") ? "#!/usr/bin/env node\n" : ""}import { x } from "@silvermoon-ai/${name}";`);
        await assert.rejects(verifyPack(plan, await pack(), directory), /Private workspace import/);
        await writeFile(join(directory, "package", file), files[file]);
      }
    }
    await rm(join(directory, "package", "dist", "adapter.d.ts"));
    packedFiles = packedFiles.filter((file) => file !== "dist/adapter.d.ts");
    await assert.rejects(verifyPack(plan, await pack(), directory), /Missing public package file: dist\/adapter\.d\.ts/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("post-publication verification requires exact bytes, version and channel", async () => {
  const bytes = Buffer.from("verified candidate");
  const metadata = {
    name: candidate.name, "dist-tags": { latest: "1.2.3" },
    versions: { "1.2.3": { name: candidate.name, version: "1.2.3", dist: {
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      tarball: `${registry}@silvermoon-ai/connector/-/connector-1.2.3.tgz`,
    } } },
  };
  await verifyPublished(plan, bytes, metadata, async () => new Response(bytes));
  await assert.rejects(verifyPublished(plan, bytes, metadata, async () => new Response("wrong")), /bytes differ/);
  await assert.rejects(verifyPublished(plan, bytes, { ...metadata, "dist-tags": { latest: "1.2.4" } }), /dist-tag/);
  await assert.rejects(verifyPublished(plan, Buffer.from("different candidate"), metadata), /integrity/);
  await assert.rejects(verifyPublished(plan, bytes, null), /not visible/);
  const foreign = structuredClone(metadata);
  foreign.versions["1.2.3"].dist.tarball = "https://example.com/package.tgz";
  await assert.rejects(verifyPublished(plan, bytes, foreign), /official registry/);
});

test("workflow triggers only npm tag pushes and retains release trust boundaries", async () => {
  const yaml = createRequire(new URL("../packages/connector/package.json", import.meta.url))("yaml");
  const workflow = yaml.parse(await readFile(new URL("../.github/workflows/publish-npm.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on, { push: { tags: ["npm/**"] } });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, { group: "npm-publish", "cancel-in-progress": false });
  const job = workflow.jobs.publish;
  assert.equal(job.environment, "npm");
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.deepEqual(job.permissions, { contents: "read", "id-token": "write" });
  assert.equal(job.env.NPM_CONFIG_REGISTRY, registry);
  for (const step of job.steps.filter((step) => step.uses)) {
    assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
  const commands = job.steps.filter((step) => step.run).map((step) => step.run).join("\n");
  assert.match(commands, /git merge-base --is-ancestor HEAD refs\/remotes\/origin\/main/);
  assert.match(commands, /npm@11\.6\.2/);
  assert.match(commands, /npm publish "\$TARBALL" --ignore-scripts --access public/);
  assert.match(commands, /--provenance --tag "\$NPM_DIST_TAG" --registry=https:\/\/registry\.npmjs\.org\//);
  assert.doesNotMatch(commands, /NPM_TOKEN|NODE_AUTH_TOKEN|npm publish \./);
  const names = job.steps.map((step) => step.name);
  assert.ok(names.indexOf("Smoke test outside the monorepo") < names.indexOf("Publish the verified tarball through OIDC"));
  assert.ok(names.indexOf("Validate and build connector dependency graph") < names.indexOf("Pack and verify the publication candidate"));
});
