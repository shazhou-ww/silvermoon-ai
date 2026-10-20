# Silvermoon Connector

`silvermoon-connector` exposes Agent Host sessions on one device through
Silvermoon Relay. Agent Host Protocol (AHP) is the only Session inventory,
identity and operation control plane. The Connector does not invoke the
Copilot SDK or depend on the Silvermoon CLI.

Connector and relay communicate through a typed tRPC router over one
authenticated WebSocket:

- mutations publish registration, heartbeats, session inventory, command
  results, and activity;
- a subscription carries list, create, follow-up, and native archive commands
  to the device.

## Requirements

- Node.js 22.12 or newer
- VS Code with a compatible Agent Host and an authenticated agent provider
- A connection token created in the Silvermoon Relay Web UI

For the end-user sign-in, device setup, and Session workflow, start with the
[Relay quick start](../../README.md#quick-start).

The guide targets Connector `0.2.1`. Run it without
cloning this repository:

```powershell
npx --yes @silvermoon-ai/connector@0.2.1 --help
```

Alternatively, install the executable globally with
`npm install --global @silvermoon-ai/connector@0.2.1` and use
`silvermoon-connector` for the commands below.

The published package includes the Silvermoon protocol and RPC implementation
used by the connector. The monorepo's private workspace packages are not
runtime dependencies for consumers.

## Generic immutable event synchronization

The source tree also provides the independent `@silvermoon-ai/connector/sync`
export (`SyncClient`, `runSync`, `ReliableEventSource`, `FileEventSource`).
It uses `/v1/sync`, not the Session tRPC endpoint, and does not adapt AHP
observations automatically. `FileEventSource` uses Node's built-in SQLite
API (Node **22.13+**, experimental on Node 22); the transport itself has no
SQLite dependency until a file source is opened. Keep the original durable
source and stream IDs across restarts. `open()` deliberately fails if a
source disappears; never replace it with `create()` as a recovery strategy.

The generic protocol is bundled into this public package, including its
declarations; consumers do not install the private `sync-protocol` workspace.
These source changes do not mean a corresponding npm version is published.
See [the generic sync guide](../../docs/event-stream-sync.md) for producer and
consumer examples, resource limits, failure semantics, and the local runtime
smoke test.

## Generic account duplex messages (v2, source tree)

The independent `@silvermoon-ai/connector/duplex` export provides a generic
`DeviceConnector`: explicit lifecycle, durable SQLite outbox/inbox, stable
submission keys, lease fencing and **explicit host durable-receipt ACK**.
It does not depend on AHP or any host domain model. Clients submit to one
owned Device; every Device event is readable by all same-Account Clients.
The thin `silvermoon-duplex` CLI uses that same public API; printing a
regulation does not acknowledge or execute it.

This is not an npm release, deployed service or external Supervisor integration.
Existing entrypoints and v1 history/UI remain unchanged. See the
[v2 contract and embedding guide](../../docs/duplex-messages.md), including
write opt-in, account-scoped decimal IDs, bounds, recovery and
`pnpm test:duplex:smoke`.

Maintainers publish reviewed versions through immutable
`npm/connector/v<version>` tags and npm Trusted Publishing. See the
[release guide](https://github.com/shazhou-ww/silvermoon-ai/blob/main/docs/npm-package-releases.md) for setup, validation and
retry behavior; do not publish locally.

## Native Done / Restore

Connector `0.2.1` supports native archive commands for live VS Code Agent Host
Sessions. The previously published `0.2.0` and `0.2.1-canary.1` do not provide
this capability. Stop the older Connector before starting `0.2.1` with the
same secure profile; do not run two with the same token. Native integration
was verified on VS Code `1.141.0` / AHP `0.10.0`.
Both Connector-level support and a current Session-level native state must be
confirmed. Incompatible Agent Hosts are unsupported.

Parent Sessions (including their default chat) dispatch
`session/isArchivedChanged` to the Session resource. Independent child chats
dispatch `chat/isArchivedChanged` to their own chat resource. An accepted
action must match the client sequence, action type, and requested archive
flag, followed by a matching native inventory. Rejection fails the operation;
timeout, disconnect, or an inconsistent result remains unconfirmed and is
never automatically replayed. Native state observed locally is published back
to Relay, without converting legacy Relay markers into commands.

Restoration is independent of send-message permission. Native VS Code archive
behavior can affect read status, child read-only state, and additional worktree
cleanup/recreation. These commands do not send a follow-up or issue extra child
archive commands.

## Run

In the Relay Web UI, open **Settings > Devices > Add device**, name the
device, and copy the generated profile before leaving Settings or refreshing.
Save it as `$HOME/.silvermoon/connector.yaml` with owner-only permissions.
For Windows, use the [secure setup command](../../README.md#3-configure-the-connector-securely)
to write the profile instead of saving a file with inherited, shared ACLs.
The connector reads the Relay address, token, and non-sensitive options from
that file:

```powershell
npx --yes @silvermoon-ai/connector@0.2.1 --working-directory .
```

Run from the project directory for new Agent Host sessions and keep the terminal
open. No token is needed on the command line. Do not run two connectors with
the same token at once.

The connector refuses to read a profile that is accessible by another
operating-system identity. Profile updates made with `--write-config` use an
atomic same-directory replacement, mode `0600` on POSIX, and a protected ACL
for only the current user on Windows:

`--write-config` saves the resolved settings and exits; it does not start a
connection. Supply the token using a hidden prompt as in the quick start, or
an owner-protected token file with `--token-file`. Do not type the token
literally into a shell command. Reconfiguring replaces an existing valid
profile, retaining resolved options; an existing unsafe profile is rejected
even when a token override is supplied.

### Save a profile on macOS or Linux

These steps use a terminal and the profile copied from **Copy profile**:

1. Create the configuration directory and restrict an existing profile before
   writing it. Back up any existing configuration securely if you need it.

   ```bash
   mkdir -p "$HOME/.silvermoon"
   if [ -e "$HOME/.silvermoon/connector.yaml" ]; then
       chmod 600 "$HOME/.silvermoon/connector.yaml"
   fi
   (umask 077; cat > "$HOME/.silvermoon/connector.yaml")
   ```

2. While `cat` is waiting, paste the **whole YAML profile**, including
   `version`, `relay`, and `token`. Press Enter, then Ctrl+D to finish.
3. Confirm owner-only permissions and clear your clipboard:

   ```bash
   chmod 600 "$HOME/.silvermoon/connector.yaml"
   ```

4. Change to your project directory and run
   `npx --yes @silvermoon-ai/connector@0.2.1 --working-directory .`.

Do not share this file or use a public/shared clipboard to transfer it.

### Options and permissions

Resolution order for the token is `SILVERMOON_CONNECTION_TOKEN`, an explicit
`--token-file` or `SILVERMOON_CONNECTION_TOKEN_FILE`, then the profile. CLI
options and the existing Relay/Copilot environment variables override profile
values. `--id`, `--display-name`, and `SILVERMOON_CONNECTOR_ID` are no longer
accepted because Relay derives the stable device identity and name from the
token.

For a checkout of this monorepo:

```powershell
pnpm --filter @silvermoon-ai/connector build
node .\packages\connector\dist\cli.js --help
```

This is a development path, not a prerequisite for using the npm release.

Relay tokens are sent only in the WebSocket `Authorization` header and are
never printed or included in connector logs.

The connector automatically reads the current user's VS Code Agent Host
endpoint registry and connects to compatible AHP 0.10 or 1.x hosts. Run the
connector as the same operating-system user as VS Code. For a portable or
custom installation, set `SILVERMOON_VSCODE_USER_DATA_DIR` or pass
`--vscode-user-data-dir <path>`.

Agent Host endpoint tokens stay in connector memory, are used only for the
local WebSocket upgrade, and are never printed or persisted by the connector.
The live provider exposes the default chat for history and follow-up messages.
When that chat is already running, follow-up text is queued behind the active
turn; otherwise it starts a new turn. If VS Code disconnects, the Connector
reports Agent Host unavailability and never switches to another Session
namespace.

## Reconnection and state confirmation

CI retains the local WebSocket reconnection regression tests. The in-flight
command test waits for inventory and result events on their specific connection
identities, without requiring a transient global registration count. It uses
the normal heartbeat interval so unrelated lease traffic does not drive the
scenario; the dedicated heartbeat test keeps its short interval.
The release deploy job still depends on the full check job, then rebuilds the
same commit with `pnpm build` instead of running lint, types, and tests again.

On each Relay connection, the connector advertises `confirmationVersion: 1`
and uploads an inventory scoped to the connection identity returned by Relay.
Current Session snapshots use increasing observation sequences. Snapshots
from a previous connection are superseded by the new inventory. Observations
made during the current inventory read retain their original newer sequence,
so the inventory cannot overwrite them. Buffered activity is
uploaded as history and must not restore old execution state.

Inventory failures are reported explicitly to Relay. **Retry state sync**
requests a new inventory without replaying message or create commands.
Heartbeats maintain the registered connection lease while inventory is
pending or failed. Commands received during registration wait for registration
to settle before executing.

Successful or failed outcomes actually observed by the adapter are retained
in memory if their upload fails or the Relay reconnects during execution.
Result uploads identify the original command connection and are retried on
heartbeats/reconnect without resending the operation. Results not observed,
or lost through a connector process restart, are not fabricated.

Adapters should explicitly return `canSendMessage` and
`executionStateKnown` for each Session. Agent Host is authoritative for both;
read-only Sessions remain read-only, and unavailable hosts fail inventory or
commands explicitly instead of returning an empty or SDK-backed success.

Use the updated Relay with migration
[`0010_session_confirmation.sql`](../../apps/worker/migrations/0010_session_confirmation.sql). Legacy
connectors remain compatible for history upload, but the updated Web/Relay
do not treat their snapshots as current-connection confirmations or permit
remote messages without confirmation.

## Embed

The package exports `VsCodeAgentHostProvider`, `SilvermoonConnector`, and the
generic `AgentAdapter` contract for embedding a connector in another local
process or adding another agent implementation later.
