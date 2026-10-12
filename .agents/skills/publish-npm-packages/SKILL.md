---
name: publish-npm-packages
description: "Prepare, publish and verify this repository's public npm packages through immutable Git tags and GitHub Actions Trusted Publishing. Use for npm releases, publishing Connector, latest or canary channels, release preflight, and investigating failed or duplicate publications."
argument-hint: "[prepare | publish | verify] [package] [version] [latest | canary]"
user-invocable: true
---

# Publish npm packages

Use the repository's existing tag workflow, not a local publishing command or
a new release system. Run commands from the repository root and adapt command
syntax to the host shell.

Read the [release guide](../../../docs/npm-package-releases.md),
[workflow](../../../.github/workflows/publish-npm.yml),
[release validator](../../../scripts/npm-release.mjs) and the selected package
manifest before acting. These files define the current behavior; do not rely
on historical releases, cached account settings or an example version.

## Establish scope and authorization

- Inspect all staged, unstaged and untracked changes. Preserve unrelated work
  and concurrent Git history; never reset, amend, force-push or broadly clean.
- Distinguish preparation, publication and verification. Loading this skill,
  accepting an implementation, or passing local tests does not authorize
  account changes, a release tag push or an npm publication.
- Before publishing, require explicit authorization for the exact package,
  version, channel and release tag. Reuse an already explicit authorization;
  do not repeatedly ask for the same decision. If scope is missing, ask one
  focused question and stop at that boundary.
- Account and repository settings require separate authorization. Do not
  initiate secret authorization flows, request tokens, add write-token secrets
  or expose credentials in logs, code or artifacts.
- If the release belongs to a Silvermoon idea, load the personal `silvermoon`
  skill and follow a fresh selected-idea report. Require exact implementation
  acceptance and synchronized deployment requirements before publishing.
  A material implementation/version change must return through implementation
  validation and acceptance; never infer lifecycle acceptance from a release
  request. Do not install Silvermoon as a repository dependency.

## Package and channel contract

Currently the only allowlisted public package is `@silvermoon-ai/connector`,
in `packages/connector`. The root, web, worker, protocol and RPC packages are
private. Do not publish recursively or assume a newly public manifest is
automatically authorized by the workflow.

| Channel | Manifest version shape | Exact tag shape |
| --- | --- | --- |
| `latest` | Stable canonical SemVer | `npm/connector/v<version>` |
| `canary` | Explicit `<base>-canary.<identifier>` | `npm/connector/v<version>` |

The complete tag version must equal the committed manifest. Canary uses the
`canary` npm dist-tag and must not move `latest`. It is maintainer-tagged:
there is no daily automation, automatic version derivation or automatic tag
creation. The validator also supports other named prereleases; do not select
one when the user requested latest or canary.

The workflow observes `npm/**` tag pushes and explicitly rejects invalid
release instructions. Legacy package-at-version tags do not trigger it.
Use the validator for canonical version/channel rules rather than adding a
second parser. Never bump a version just because a previous tag exists.

## Prepare without publishing

1. Refresh `origin/main` and inspect the package manifest, current public
   versions and dist-tags at `https://registry.npmjs.org/`. Record the existing
   `latest` value before canary publication. Network/authentication failures
   are failures, not proof a version is absent.
2. Select an explicitly agreed, unpublished version. If requested, update the
   manifest in a reviewed candidate; preserve existing latest installation
   examples when preparing canary. Do not mutate a manifest only inside CI.
3. Run the existing release checks:

   ```powershell
   pnpm test:release
   pnpm lint
   pnpm --filter @silvermoon-ai/connector... typecheck
   pnpm --filter @silvermoon-ai/connector... --if-present test
   pnpm --filter @silvermoon-ai/connector... build
   ```

   Use frozen dependencies as described in the guide. Install/restore only
   after a manifest change or a missing-dependency failure.
4. Run `node scripts\npm-release.mjs plan <exact-tag>` against the actual
   candidate. Require matching `version`, `dist_tag` and package directory.
   This queries npm but neither creates a tag nor publishes.
5. Pack the built package with `npm pack --ignore-scripts --json` into an
   operation-owned temporary directory. Save the JSON output outside the
   repository and run:

   ```powershell
   node scripts\npm-release.mjs verify-pack <exact-tag> <pack-json> <artifact-directory>
   ```

   Install that exact tarball in a clean directory outside the monorepo with
   `--ignore-scripts`, add consumer development tooling `@types/node@24`, then
   run `node scripts\smoke-npm-package.mjs <consumer-directory>` from the root.
   The checker uses the checkout's TypeScript installation.
6. Require matching tarball identity and intact CLI, exports and declarations.
   Keep private protocol/RPC runtime and declaration code inlined by tsup.
   Do not mask private imports by installing workspace packages in the consumer.
   The smoke uses `skipLibCheck` for upstream declarations; the separate pack
   checker still rejects private workspace imports.
7. Synchronize the reviewed candidate normally to main and complete any
   applicable implementation gate. Local pack/smoke is not a real publication.

## Confirm external readiness

Read the guide's one-time configuration section and observe current settings:

- npm Trusted Publisher must identify `shazhou-ww`, `silvermoon-ai`,
  `publish-npm.yml` and environment `npm`, permitting direct publication.
  This authorizes both channels. Obtain administrator confirmation when npm
  configuration cannot be inspected; only a real run proves OIDC acceptance.
- GitHub environment `npm` must allow release tags, not branches. Verify active
  release-tag creation/update/deletion restrictions and main protection.
  A tagged workflow cannot enforce its own safety against unauthorized tags.
- Verify the source repository is public, Actions and the publish workflow are
  enabled, and required approvals/actions policies permit the run.
- Stop when an external prerequisite is missing. Do not replace OIDC with a
  token or loosen protections. Account configuration changes are not implied
  by a publication request.

## Publish only the authorized tag

1. Freeze a full source commit reachable from freshly fetched `origin/main`.
   Inspect the manifest at that exact commit, not just the worktree. Recheck
   the exact version's absence, current channel baseline and remote tag.
2. If the tag or version already exists, inspect its source and run before any
   further action. Never move/delete the tag, republish, unpublish, or alter a
   dist-tag to make a rerun appear successful.
3. After confirming authorization and readiness, create the exact tag at the
   approved commit and push only `refs/tags/<exact-tag>`. Never push all tags,
   tag an unmerged branch, or run `npm publish` locally.
4. Resolve the matching `publish-npm.yml` run with `gh run list`; verify its
   tag and `headSha`, then wait with `gh run watch <run-id> --exit-status`.
   Record the immutable source and run URL.
5. Require successful build, checks, pack, external smoke, OIDC publication and
   registry verification. The workflow publishes its verified tarball with
   explicit channel, public access and provenance at the official registry.

## Verify and report

- Require the exact public version/channel, integrity and registry bytes to
  match the workflow candidate. Use the candidate digest from the Actions run;
  downloading a public tarball and comparing it to itself is not candidate
  equivalence. The workflow's `verify-published` step performs that comparison.
- Independently install the exact public version from the official registry
  outside the monorepo and run the same consumer smoke. Verify the installed
  manifest version. Do not substitute a local tarball for public-install proof.
- For canary, confirm `canary=<authorized-version>` and `latest` equals the
  recorded baseline. Do not execute a stable release just to test latest
  support. The smoke does not authenticate Copilot or verify a live Relay
  session.
- On failure, identify whether npm accepted publication. A successful publish
  followed by verification failure leaves an immutable version; inspect it
  rather than rerunning publication. The workflow deliberately fails early
  when an exact version exists, and bounded propagation retries are not a
  second publication. External publishers can race the preflight.
- Publication runs share one concurrency group; do not cancel an active
  publish. GitHub may replace an older pending run, so release sequentially.
- Record authorization, source/tag, Actions outcome, channel baselines and
  actual checks in the owning deployment evidence when applicable. Follow the
  Silvermoon submission/review gate without manufacturing acceptance.
- Clean only operation-owned temporary files/directories. Summarize what was
  prepared versus actually published and any remaining blockers. Do not
  automatically create GitHub Releases.
