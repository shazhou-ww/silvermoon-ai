import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const registry = "https://registry.npmjs.org/";
const root = fileURLToPath(new URL("..", import.meta.url));
const packageDirectory = "packages/connector";
const packageName = "@silvermoon-ai/connector";
const privatePackages = ["@silvermoon-ai/protocol", "@silvermoon-ai/rpc"];

export function releasePlan(tag, manifest) {
  const match = /^npm\/connector\/v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)$/.exec(tag);
  assert.ok(match, "Tag must be npm/connector/v<canonical-semver>, without build metadata.");
  assert.equal(match[0], tag, "Release tag must not contain trailing whitespace.");
  const version = match[1];
  assert.ok(match.slice(2, 5).every((part) => Number.isSafeInteger(Number(part))),
    "SemVer components must be safe integers.");
  let distTag = "latest";
  if (match[5]) {
    const parts = match[5].split(".");
    assert.ok(parts.every((part) => !/^\d+$/.test(part) ||
      /^(0|[1-9]\d*)$/.test(part) && Number.isSafeInteger(Number(part))),
    "Numeric prerelease identifiers must be canonical safe integers.");
    assert.match(parts[0], /^[a-z][a-z0-9-]*$/i,
      "Prerelease must start with a named channel such as alpha, beta or rc.");
    distTag = parts[0].toLowerCase();
    assert.notEqual(distTag, "latest", "Prereleases cannot publish to latest.");
  }
  assert.equal(manifest.name, packageName, "Package name is not allowlisted.");
  assert.notEqual(manifest.private, true, "Cannot publish a private package.");
  assert.equal(manifest.version, version, "Tag version must exactly match the committed manifest.");
  assert.equal(manifest.publishConfig?.access, "public", "Package must have public access.");
  assert.equal(manifest.publishConfig?.registry, registry, "Package must use the official npm registry.");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      assert.ok(!privatePackages.includes(name), `Private runtime dependency: ${name}`);
      assert.ok(!/^(workspace:|file:|link:)/.test(range), `Nonportable dependency: ${name}`);
    }
  }
  return { packageName, packageDirectory, version, distTag };
}

export async function registryMetadata(fetchImpl = fetch) {
  const response = await fetchImpl(`${registry}${encodeURIComponent(packageName)}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  assert.ok(response.ok, `npm registry returned HTTP ${response.status}; refusing to assume absence.`);
  const metadata = await response.json();
  assert.equal(metadata.name, packageName, "Unexpected registry package identity.");
  assert.ok(metadata.versions && typeof metadata.versions === "object", "Invalid npm versions metadata.");
  return metadata;
}

export function requireUnpublished(plan, metadata) {
  assert.ok(!metadata?.versions[plan.version],
    `${plan.packageName}@${plan.version} already exists. No publish or dist-tag changes are allowed on rerun.`);
}

async function loadPlan(tag) {
  return releasePlan(tag, JSON.parse(await readFile(resolve(root, packageDirectory, "package.json"), "utf8")));
}

async function outputs(values) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  console.log(JSON.stringify(values, null, 2));
}

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

export function validatePackManifest(plan, manifest) {
  releasePlan(`npm/connector/v${plan.version}`, manifest);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.bin?.["silvermoon-connector"], "./dist/cli.js");
  assert.deepEqual(manifest.exports, {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./adapter": { types: "./dist/adapter.d.ts", default: "./dist/adapter.js" },
  }, "Public entrypoints changed; update the package smoke contract deliberately.");
}

export async function verifyPack(plan, pack, directory) {
  assert.equal(pack.length, 1, "Exactly one package must be packed.");
  const record = pack[0];
  assert.equal(record.name, plan.packageName);
  assert.equal(record.version, plan.version);
  assert.equal(record.filename, basename(record.filename), "Tarball filename must not escape its directory.");
  assert.match(record.filename, /\.tgz$/);
  const tarball = resolve(directory, record.filename);
  const bytes = await readFile(tarball);
  assert.equal(record.shasum, digest(bytes, "sha1", "hex"));
  assert.equal(record.integrity, `sha512-${digest(bytes, "sha512", "base64")}`);
  const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim().split(/\r?\n/);
  const content = (name) => execFileSync("tar", ["-xOf", tarball, `package/${name}`], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  for (const file of files) {
    assert.ok(/^package\/(?:package\.json|README\.md|LICENSE(?:\.md)?|dist\/[\w./-]+)$/.test(file) &&
      !file.split("/").includes(".."), `Unexpected tarball file: ${file}`);
  }
  for (const file of ["package.json", "README.md", "dist/cli.js", "dist/index.js",
    "dist/index.d.ts", "dist/adapter.js", "dist/adapter.d.ts"]) {
    assert.ok(files.includes(`package/${file}`), `Missing public package file: ${file}`);
  }
  validatePackManifest(plan, JSON.parse(content("package.json")));
  assert.match(content("dist/cli.js"), /^#!\/usr\/bin\/env node\r?\n/, "CLI must retain its Node shebang.");
  for (const file of files.filter((file) => /\.(?:js|ts)$/.test(file))) {
    assert.doesNotMatch(content(file.slice("package/".length)),
      /(?:from\s*|import\s*\(|require\s*\()\s*["']@silvermoon-ai\/(?:protocol|rpc)(?:["'/])/,
      `Private workspace import remains in ${file}`);
  }
  return { tarball, sha256: digest(bytes, "sha256", "hex"), integrity: record.integrity };
}

export async function verifyPublished(plan, bytes, metadata, fetchImpl = fetch) {
  const published = metadata?.versions[plan.version];
  assert.equal(published?.name, plan.packageName, "Published package is not visible yet.");
  assert.equal(published.version, plan.version);
  assert.equal(metadata["dist-tags"]?.[plan.distTag], plan.version, "npm dist-tag does not match.");
  assert.equal(published.dist?.integrity, `sha512-${digest(bytes, "sha512", "base64")}`,
    "Published integrity differs from the verified candidate.");
  const url = new URL(published.dist.tarball);
  assert.equal(url.origin, new URL(registry).origin, "Tarball must come from the official registry.");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Tarball returned HTTP ${response.status}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, "Published tarball bytes differ.");
}

async function main(args) {
  const [mode, tag, input, directory] = args;
  assert.ok(
    mode === "plan" && args.length === 2 ||
    mode === "verify-pack" && args.length === 4 ||
    mode === "verify-published" && args.length === 3,
    "Usage: npm-release.mjs plan <tag> | verify-pack <tag> <pack-json> <directory> | verify-published <tag> <tarball>",
  );
  const plan = await loadPlan(tag);
  if (mode === "plan") {
    requireUnpublished(plan, await registryMetadata());
    await outputs({ package_directory: plan.packageDirectory, version: plan.version, dist_tag: plan.distTag });
  } else if (mode === "verify-pack") {
    await outputs(await verifyPack(plan, JSON.parse(await readFile(input, "utf8")), directory));
  } else {
    const bytes = await readFile(input);
    for (let attempt = 1; attempt <= 12; attempt++) {
      try {
        await verifyPublished(plan, bytes, await registryMetadata());
        console.log(`Verified ${plan.packageName}@${plan.version} (${plan.distTag}): exact registry bytes.`);
        return;
      } catch (error) {
        console.error(`Registry verification ${attempt}/12 failed: ${error.message}`);
        if (attempt === 12) throw error;
        await new Promise((done) => setTimeout(done, 15_000));
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(`npm release failed: ${error.message}`);
    process.exitCode = 1;
  });
}
