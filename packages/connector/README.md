# Silvermoon Connector

`silvermoon-connector` exposes GitHub Copilot sessions on one device through
Silvermoon Relay. It uses the official `@github/copilot-sdk` for persisted
Copilot sessions and the official Agent Host Protocol (AHP) for live sessions
owned by VS Code. It does not invoke or depend on the Silvermoon CLI.

Connector and relay communicate through a typed tRPC router over one
authenticated WebSocket:

- mutations publish registration, heartbeats, session inventory, command
  results, and activity;
- a subscription carries list, create, and follow-up commands to the device.

## Requirements

- Node.js 22.12 or newer
- A locally authenticated GitHub Copilot account
- A connection token created in the Silvermoon Relay Web UI
- VS Code with Agent Host support when live editor sessions should be exposed

The Copilot SDK includes its verified platform runtime when available. Set
`COPILOT_CLI_PATH` only when an existing Copilot CLI installation should be
used instead.

For the end-user sign-in, device setup, and Session workflow, start with the
[Relay quick start](../../README.md#quick-start).

The public npm release verified for that guide is `0.2.0`. Run it without
cloning this repository:

```powershell
npx --yes @silvermoon-ai/connector@0.2.0 --help
```

Alternatively, install the executable globally with
`npm install --global @silvermoon-ai/connector@0.2.0` and use
`silvermoon-connector` for the commands below.

The published package includes the Silvermoon protocol and RPC implementation
used by the connector. The monorepo's private workspace packages are not
runtime dependencies for consumers.

Maintainers publish reviewed versions through immutable
`npm/connector/v<version>` tags and npm Trusted Publishing. See the
[release guide](https://github.com/shazhou-ww/silvermoon-ai/blob/main/docs/npm-package-releases.md) for setup, validation and
retry behavior; do not publish locally.

## Run

In the Relay Web UI, open **Settings > Devices > Add device**, name the
device, and copy the generated profile before leaving Settings or refreshing.
Save it as `$HOME/.silvermoon/connector.yaml` with owner-only permissions.
For Windows, use the [secure setup command](../../README.md#3-configure-the-connector-securely)
to write the profile instead of saving a file with inherited, shared ACLs.
The connector reads the Relay address, token, and non-sensitive options from
that file:

```powershell
npx --yes @silvermoon-ai/connector@0.2.0 --working-directory .
```

Run from the project directory for new Copilot sessions and keep the terminal
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
   `npx --yes @silvermoon-ai/connector@0.2.0 --working-directory .`.

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

The SDK uses the local GitHub Copilot authentication available to the user.
`--approve-all` allows remotely initiated sessions to approve every Copilot
permission request. This enables unattended tool execution and local side
effects, so it is intentionally opt-in.

The connector automatically reads the current user's VS Code Agent Host
endpoint registry and connects to compatible AHP 0.10 or 1.x hosts. Run the
connector as the same operating-system user as VS Code. For a portable or
custom installation, set `SILVERMOON_VSCODE_USER_DATA_DIR` or pass
`--vscode-user-data-dir <path>`.

Agent Host endpoint tokens stay in connector memory, are used only for the
local WebSocket upgrade, and are never printed or persisted by the connector.
The live provider exposes the default chat for history and follow-up messages.
When that chat is already running, follow-up text is queued behind the active
turn; otherwise it starts a new turn. If VS Code disconnects, sessions that
also exist in SDK storage fall back to their persisted metadata.

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
`executionStateKnown` for each Session. A readable persisted SDK catalog
confirms that the adapter can attempt continuation, not that the agent is
currently idle. Such Sessions have unknown execution state until a trustworthy
status observation is available. Explicit continuation can fail and reports
that failure normally. Read-only Agent Host Sessions remain read-only.

Use the updated Relay with migration
[`0010_session_confirmation.sql`](../../apps/worker/migrations/0010_session_confirmation.sql). Legacy
connectors remain compatible for history upload, but the updated Web/Relay
do not treat their snapshots as current-connection confirmations or permit
remote messages without confirmation.

## Embed

The package exports `CopilotAgentAdapter`, `VsCodeAgentHostProvider`,
`SilvermoonConnector`, and the generic `AgentAdapter` and
`AgentHostSessionProvider` contracts for embedding a connector in another
local process or adding another agent implementation later.
