# Silvermoon Relay

Silvermoon Relay is an online control plane for agent sessions that run on
your own devices. Each device runs a local connector; the Web UI can then
create sessions, follow their activity, and continue the conversation from
any signed-in browser.

The project uses Silvermoon as its product concept, but it does **not** depend
on the Silvermoon CLI or its repository format. The first connector adapter
controls persisted GitHub Copilot sessions through the official
`@github/copilot-sdk` and live VS Code sessions through the official Agent
Host Protocol (AHP).

## Architecture

```text
Browser
  │ authenticated HTTP control plane
  ▼
Cloudflare Worker ─── D1 (connectors, sessions, events, commands)
  │
  │ authenticated tRPC over WebSocket
  ▼
silvermoon-connector ─── GitHub Copilot SDK ─── local Copilot sessions
                     └── VS Code Agent Host ─── live Copilot sessions
```

- `apps/web`: React/Vite dashboard for devices, sessions, live activity,
  follow-up messages, identities, and connection tokens.
- `apps/worker`: Cloudflare Worker, Durable Object WebSocket relay, OIDC
  login, HTTP control plane, and D1 migrations.
- `packages/protocol`: runtime-validated connector, session, event, and command
  domain schemas.
- `packages/rpc`: the typed tRPC contract shared by the relay and connectors.
- `packages/connector`: publishable `silvermoon-connector` CLI and GitHub
  Copilot adapter.

The connector sends registration, inventory, command results, and session
events through tRPC mutations. The relay sends session commands through a
tRPC subscription on the same WebSocket. Persisted session history is loaded
on demand, uploaded in bounded event batches, and coalesced by the relay when
the same session is already synchronized or has a history command in flight.
The connector also discovers Agent Host endpoints published by VS Code for the
current operating-system user. Live Agent Host metadata wins when the same
session is also present in SDK storage; the connector falls back to persisted
SDK metadata when the host disconnects.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.27.0
- A Cloudflare account only for remote resource operations
- A locally authenticated GitHub Copilot account on connector devices

No production credential is required for installation, tests, local D1, or a
Worker dry run.

## Develop

```powershell
pnpm install
pnpm --filter @silvermoon-ai/worker d1:migrate:local
pnpm dev
```

Copy `apps/web/.env.example` to `apps/web/.env.local` when the relay origin
needs to differ from `https://relay.silvermoon.work`. Put local Worker secrets
in `apps/worker/.dev.vars`; neither file is committed.

The message stream opens at the latest visible event and follows updates only
while within 64 CSS pixels of the bottom. Scrolling farther up preserves the
reading position; **Jump to latest** returns to the bottom and resumes following.
The control supports keyboard activation and respects reduced-motion preferences.

Choose **Settings** from the avatar menu to open the right-side configuration
page at `/settings`. It contains Devices and Linked identities; browser login
management is no longer shown. **Sign out** in the avatar menu signs out only
the current browser. On narrow screens, the list icon opens the existing
Session navigation in a drawer.

Devices has an **Add device** action that expands the device name and expiry
inputs inline; **Cancel** discards the unsubmitted form. Copy generated
connector profiles before leaving Settings or refreshing: complete tokens are
not cached or redisplayed after navigation.

Each account, Device, and Session has its own follow-up draft in tab-local
`sessionStorage`. Switching Sessions or opening Settings preserves drafts, and
refreshing restores them. Browser tab restoration may also restore this
storage; there is no cross-tab synchronization. Storage failures are reported
explicitly. Sign out or confirmed authentication expiry clears the account's
draft cache. Failed deliveries retain the input; a successful command clears
only the submitted version, not newer edits or another Session's draft.
Returning to the same Session after temporarily viewing Settings preserves its
reading position and follow intent; opening a different Session or refreshing
still opens the latest activity.

Run the Web browser regressions (mocked relay API, no production credentials):

```powershell
pnpm --filter @silvermoon-ai/web exec playwright install chromium
pnpm --filter @silvermoon-ai/web test:browser
```

These cover desktop and narrow-screen positioning, history protection, Session
switching, filtering, reconnects, layout changes, Settings routes and drawers,
independent drafts, asynchronous delivery, and accessible return controls.

### Offline Sessions and current state

The Session list hides offline Devices' Sessions by default. **Show offline
Sessions** is part of the existing view-options menu, alongside **Show ended**
and **Show unavailable**. Its count follows the search and those visibility
options. Offline history appears only in **All**, displays **Offline** rather
than an old execution status, and does not contribute to Active, Needs input,
or Failed. Search and status filters combine without clearing one another;
each status count describes the search scope, independently of the selected
status. The Web app loads all Session pages rather than counting only the first
500 records.

An open Session stays open when its Device disconnects. Saved content,
reading position, and local drafts remain available; drafts are not queued or
sent automatically. Reconnecting alone does not restore sending: Relay must
confirm the Session's capabilities for the current connection. Execution
state is confirmed separately. Persisted SDK metadata has unknown execution
state, but can still support explicitly continuing the Session when its
current capability permits it. Existing read-only restrictions still apply.

Connector observations carry a connection identity and increasing sequence;
old connections and older snapshots cannot replace current state or
capabilities. A new observation made while the current inventory is being
read is retained with its original sequence; the inventory cannot overwrite it.
Buffered events are retained as history, not replayed as current execution
state. Initial inventory failures are explicit and can be retried
through **Retry state sync**; complete history synchronization remains separate.
An older history request with an unknown result does not block an explicit new
read-only history sync; the old command record remains unknown until confirmed.

Delivered commands whose results are not confirmed remain **unknown** after
reconnection rather than being marked as execution failures or resent. The
connector retains outcomes it actually observes in memory, including outcomes
observed while disconnected, and uploads them with the original command's
connection identity. Retrying this result upload never re-executes the command.
A process restart can lose that in-memory evidence: if no trustworthy result
is recoverable, it remains unknown; **Stop watching this result** only
stops the local watch and never changes the stored outcome or resends it.

Refresh failures keep saved content and local drafts, explicitly mark current
information as unconfirmed, and disable remote operations. **Retry refresh**
reloads both Device and Session indexes. Slow paginated reads do not overlap
the next inventory poll. If a successfully read index no longer includes the
open Session, the UI reports it unavailable, clears its content, and waits for
the user to select another Session rather than silently changing the selection.

This revision requires migration
[`0010_session_confirmation.sql`](./apps/worker/migrations/0010_session_confirmation.sql) and the
updated Relay and connector before current-connection confirmation is
available. The transport retains protocol version 2 with opt-in
`confirmationVersion: 1`. Older connectors may still publish saved inventory
and history, but cannot confirm current state or enable remote follow-ups;
the UI explicitly requests a connector update. Apply the schema and update
Relay before updating connectors and Web. Builds use only a Worker dry run;
they do not apply migrations or deploy.

## Run a connector

Choose **Add device** in the Web UI, name it once, and save the generated
profile as `$HOME/.silvermoon/connector.yaml`. Then build and start the
connector on the device that owns the Copilot sessions:

```powershell
pnpm --filter @silvermoon-ai/connector build
node .\packages\connector\dist\cli.js
```

The WebSocket endpoint is derived from the relay origin:

```text
wss://relay.silvermoon.work/v1/connect
```

Relay derives the stable device identity and name from the token. The
connector cannot provide or override either value. The token is sent only in
the WebSocket `Authorization` header and is never placed in the URL or logs.

Existing environment variables and a protected token file remain supported.
Token priority is `SILVERMOON_CONNECTION_TOKEN`, an explicit token file, then
the profile:

```powershell
node .\packages\connector\dist\cli.js `
  --token-file C:\Users\me\.config\silvermoon-relay-token
```

CLI options and Relay/Copilot environment variables override non-sensitive
profile values. Use `--write-config` with an environment token or token file
to atomically write the profile. It is mode `0600` on POSIX and grants access
only to the current user on Windows; unsafe profile permissions are rejected.
Legacy `--id`, `--display-name`, and `SILVERMOON_CONNECTOR_ID` settings must be
removed when upgrading the CLI. Relay remains compatible with already deployed
connectors: it accepts their ID and display-name path, header, and registration
fields but ignores those values in favor of the token-bound Device identity.

Run `silvermoon-connector --help` for all environment variables and options.
`--approve-all` allows remotely initiated sessions to approve every Copilot
permission request and can trigger local side effects. It is intentionally
opt-in.

Live VS Code sessions are discovered automatically from the current user's
VS Code data directory. Use `--vscode-user-data-dir` or
`SILVERMOON_VSCODE_USER_DATA_DIR` for portable, Insiders, or other custom
profiles. The connector must run as the same operating-system user as VS Code;
Agent Host connection tokens are read from the owner-local endpoint registry,
used only for the local WebSocket upgrade, and never logged or persisted by
the connector.

## Identity and connection tokens

The Web app signs users in through Google, Microsoft Account, or GitHub.
Production callbacks are:

```text
https://relay.silvermoon.work/auth/google/callback
https://relay.silvermoon.work/auth/microsoft/callback
https://relay.silvermoon.work/auth/github/callback
```

OAuth client credentials and relay security keys are Worker secrets:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
SESSION_SECRET_PREVIOUS
CONNECTION_TOKEN_PEPPER
CONNECTION_TOKEN_PEPPER_PREVIOUS
```

Connection tokens use the `smr1_<public-id>_<secret>` format. The complete
token is returned only when it is created or rotated; D1 stores its public ID,
display hint, metadata, and a peppered HMAC. Browser sessions and OAuth
provider tokens are separate credentials and cannot connect a device.

During secret rotation, set the previous session secret or token pepper in the
matching `_PREVIOUS` binding until old sessions or tokens have been rotated,
then remove it.

## Validate

```powershell
pnpm check
pnpm --filter @silvermoon-ai/worker d1:migrate:local
pnpm --filter @silvermoon-ai/worker build
node .\packages\connector\dist\cli.js --help
```

## Package scope migration

Workspace packages now use the Silvermoon-AI npm scope:

| Previous package | New package | Publication boundary |
| --- | --- | --- |
| `@silvermoon-relay/connector` | `@silvermoon-ai/connector` | Public |
| `@silvermoon-relay/protocol` | `@silvermoon-ai/protocol` | Private workspace package |
| `@silvermoon-relay/rpc` | `@silvermoon-ai/rpc` | Private workspace package |
| `@silvermoon-relay/worker` | `@silvermoon-ai/worker` | Private application package |
| `@silvermoon-relay/web` | `@silvermoon-ai/web` | Private application package |

Consumers of the connector should replace the package spec and imports with
`@silvermoon-ai/connector`. The `silvermoon-connector` executable name and
relay protocol remain unchanged. The public connector bundles the protocol
and RPC implementation it needs, so consumers do not install the private
workspace packages. After the new package is available, registry maintainers
should deprecate the legacy connector with a message that points to
`@silvermoon-ai/connector`; the private workspace packages must not be
published under either scope.

## Release

Pull requests and pushes to `main` or `release` run the quality gate. Only a
push produced by merging into `release` runs deployment:

1. apply remote D1 migrations;
2. deploy the Worker and Durable Object;
3. deploy `apps/web/dist` to the `silvermoon-work` Pages project.

The repository must provide `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. Scope the token only to the
target account's Workers Scripts, D1, and Pages edit operations.
