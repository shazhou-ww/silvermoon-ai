# npm package releases

Public packages are published only by [publish-npm.yml](../.github/workflows/publish-npm.yml)
from immutable Git tags on commits reachable from refreshed `origin/main`.
This follows the tag and npm Trusted Publishing approach in Silvermoon.
There is no local publication, scheduled canary, manual workflow dispatch,
automatic version bump, or automatic GitHub Release.

## Package and tag contract

| Release key | npm package | Directory | Tag |
| --- | --- | --- | --- |
| `connector` | `@silvermoon-ai/connector` | `packages/connector` | `npm/connector/v<version>` |

The root, web, worker, protocol and RPC packages are private and cannot be
published by this workflow. Adding another public package requires an explicit
allowlist, validation, smoke test and documentation change.

The workflow observes every `npm/**` tag push so invalid release instructions
fail explicitly rather than silently selecting a package. Tags outside `npm/`
(including the historical `@silvermoon-ai/connector@0.1.0` pattern) do not
trigger it. The only accepted release key is `connector`.

The tag version must exactly match the committed Connector manifest and use
canonical SemVer. Leading zeroes, build metadata (`+...`), unknown keys and
version mismatches fail. Stable versions publish to `latest`. Prereleases must
start with a named channel, for example `1.2.3-rc.1` publishes to `rc`, not
`latest`. Numeric-only channels and a `latest` prerelease channel fail. A
`canary`-named prerelease is possible only with a matching committed manifest
and explicitly created tag; there is no canary automation.

## One-time external configuration

Before creating a release tag, a package/repository administrator must:

1. In npm settings for **`@silvermoon-ai/connector`**, add a **GitHub Actions
   Trusted Publisher**:
   - Organization/user: `shazhou-ww`
   - Repository: `silvermoon-ai`
   - Workflow filename: `publish-npm.yml`
   - Environment: `npm`
   - Allowed action: direct `npm publish` (not stage-only).
   Open the package's **Settings → Trusted publishing → Add trusted publisher**,
   select **GitHub Actions**, enter these values and save. The same publisher
   authorizes both `latest` and `canary`; no channel-specific token is needed.
   npm currently requires a new publisher configuration to complete its first
   successful publish within two days, or it expires. Configure it when the
   first authorized canary release is ready; recreate an expired configuration
   instead of falling back to a token.
2. Create the GitHub environment **`npm`**. Its custom deployment policy must
   allow only release tags matching `npm/*/*`, not branches. Add required
   reviewers if releases require approval. This environment holds no npm secret.
3. Create an active GitHub **tag ruleset** targeting `npm/**`. Restrict creation
   to authorized release maintainers and disallow updates/deletion of existing
   tags. Protect `main` and review changes to the workflow and release scripts.
   No deploy key is needed because maintainers, not automation, create tags.
4. Enable GitHub Actions and permit the pinned official checkout, setup-node
   and pnpm setup actions used by this workflow. npm provenance requires a
   public source repository and a GitHub-hosted runner.

Do not create `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or an npm write-token secret.
Node 24 and pinned npm 11.6.2 satisfy npm's OIDC CLI requirement (11.5.1+).
Only the release job receives `contents: read` and `id-token: write`; there is
no repository write permission or PR trigger. Checkout does not persist Git
credentials. npm automatically exchanges the GitHub OIDC identity for
short-lived publishing authorization.

The tag ruleset and environment are essential: GitHub reads the workflow from
the tagged commit. A check inside that workflow cannot protect against an
unauthorized person tagging a malicious replacement workflow. The ancestry
check independently rejects unmerged commits, but does not replace tag and
main protection. The `npm/*/*` environment glob is a deployment filter, not a
SemVer validator; the release script performs exact validation.

These account settings are external prerequisites, not configured by code.
Changing the repository, environment or workflow filename requires updating
the npm Trusted Publisher identity before another publication.

## Prepare and publish an authorized version

1. Read the registry first:

   ```powershell
   npm view @silvermoon-ai/connector version dist-tags --json --registry=https://registry.npmjs.org/
   ```

   Do not infer the next version from an old tag or the current manifest alone.
   At implementation time, npm `latest` was `0.2.0` while the committed
   manifest was `0.1.0`. This change intentionally does not choose or bump a
   release version. Select a new, unpublished version and update
   `packages/connector/package.json` in a reviewed commit.

2. Validate without publishing:

   ```powershell
   pnpm install --frozen-lockfile
   node --test scripts\npm-release.test.mjs
   pnpm lint
   pnpm --filter @silvermoon-ai/connector... typecheck
   pnpm --filter @silvermoon-ai/connector... --if-present test
   pnpm --filter @silvermoon-ai/connector... build
   ```

   The workflow also checks the actual `npm pack` tarball and installs that
   file in a clean directory outside the monorepo. It verifies CLI `--help`,
   root/adapter runtime exports and TypeScript declarations. Private protocol
   and RPC runtime/declaration code must stay inlined by tsup; consumers must
   never need private workspace packages.

3. Merge the version and workflow changes to `main`. If publication belongs
   to an active Silvermoon idea, follow its current lifecycle report and obtain
   the exact implementation acceptance before deployment; implementing this
   mechanism does not accept any existing idea or authorize a release.
4. After explicit release authorization and external setup, fetch main and
   tags, check the selected version in the manifest at `origin/main`, then
   create and push **only that tag**. For an authorized `1.2.3` release:

   ```powershell
   git fetch origin main --tags
   git show origin/main:packages/connector/package.json
   git tag npm/connector/v1.2.3 origin/main
   git push origin refs/tags/npm/connector/v1.2.3
   ```

   `1.2.3` is an example, not a release instruction. Use the exact approved
   committed version. Do not tag an unmerged branch, move an existing tag,
   push all tags, or run `npm publish` locally.

For canary, commit an explicit unpublished version such as `1.2.3-canary.1`
and push `npm/connector/v1.2.3-canary.1` at that reviewed main commit.
The example is not a version selection or release authorization. The workflow
publishes with `--tag canary`; it does not modify `latest`. Both channels are
supported, but this mechanism's first real deployment verification uses only
canary: record the existing `latest` value before publication, verify canary
metadata and install the published version outside the monorepo, then confirm
`latest` is unchanged. A real stable release is not required for that gate.

The workflow validates the tag, manifest and official registry before
installing frozen dependencies. It then lints, typechecks, tests and builds
the Connector dependency graph. `npm pack --ignore-scripts` creates one
candidate; verification checks its actual manifest, required files, private
imports, shasum and integrity. No package or credentials are uploaded as
Actions artifacts. The clean-install smoke uses `--ignore-scripts`, adds only
`@types/node@24` as consumer-side development tooling, and uses the existing
repository TypeScript settings (`ESNext.Disposable`, `skipLibCheck`). Consumer
code is typechecked; third-party declaration bodies are not, because upstream
`vscode-jsonrpc` declarations conflict with modern disposable iterator types.
The separate tarball check rejects private workspace imports in both JavaScript
and declarations regardless of `skipLibCheck`. The smoke does not authenticate
Copilot or contact Relay, and does not test a real agent session.

Publication uses that exact verified tarball, after rechecking SHA-256,
with `--access public --provenance` at `https://registry.npmjs.org/`.
After publication, a bounded registry check (12 attempts, 15 seconds apart,
30-second request timeouts) requires exact version, dist-tag, integrity and
downloaded tarball bytes. It reports failures explicitly; a verification
failure after publication does not undo the immutable npm version.

## Concurrency, retries and failures

All release runs share one `npm-publish` concurrency group and do not cancel
an in-progress publication. GitHub concurrency retains at most one pending
run; a newer pending run can replace an older one. Push releases sequentially
and explicitly rerun a canceled pending workflow when necessary.

An existing exact npm version causes a clear failure **before publication**,
including reruns of a successful or partly successful release. Reruns do not
silently claim success, republish, or move a dist-tag. This is deliberately
simpler than Silvermoon's canary/recovery machinery.

If failure occurs before npm accepts publication and the version remains
absent, fix the external configuration and rerun the same immutable tag's
workflow. If code needs fixing, merge a new reviewed commit and use a new
approved version/tag rather than moving the tag. If publication succeeded but
the subsequent registry check failed, inspect npm and the Actions logs; do not
republish or unpublish to recover. An external publisher can race the registry
preflight; npm atomically rejects duplicate publication and the job fails
without replacing the existing version.

Registry/network/authentication errors are failures, never treated as package
absence. Local tests, `npm pack`, and clean-install smoke are not evidence that
OIDC authentication or a real publication has succeeded. Those can only be
verified during a separately authorized first release.
