# Silvermoon Relay

Access GitHub Copilot Sessions on your own devices from a browser.
[Open Silvermoon Relay](https://silvermoon.work).

When work is running on another computer, Relay gives you one place to find
Sessions, read their messages and activity, and send follow-up instructions
when the Session supports them. A local **Connector** keeps that device
connected; agents and their tools still run on that device, not in your
browser.

## When to use it

- Check an agent's progress from another computer or a phone.
- Find and continue Copilot Sessions across your connected devices.
- Start a new Copilot Session on an online device without opening a terminal
  on that device again.
- Follow supported live VS Code Sessions alongside saved Copilot Sessions.
  Live discovery requires VS Code with Agent Host support; not every editor
  chat is exposed or writable.

Relay does not keep a sleeping or disconnected device running. Messages and
Session activity are sent to the Relay service so you can view them remotely;
use it only for work you are comfortable accessing through that service.

## Quick start

The shortest path is: **sign in, add a device, configure its Connector, then
open a Session**. You do not need to clone this repository.

### 1. Prepare the device that will run your agent

- Install **Node.js 22.12 or newer**, with npm/npx available.
- Authenticate GitHub Copilot locally as the operating-system user who will
  run the Connector. If you have not done this, follow GitHub's
  [Copilot CLI quickstart](https://docs.github.com/en/copilot/get-started/cli-quickstart)
  and complete `/login` in the CLI. You need an account allowed to use Copilot.
  Signing into Relay in a browser does **not** sign the local agent into Copilot.
- Keep this device awake, online, and able to reach the Relay service. For
  live VS Code Sessions, run VS Code and the Connector as the same user.

The commands below use the public npm package
[`@silvermoon-ai/connector`](https://www.npmjs.com/package/@silvermoon-ai/connector),
version **0.2.0** (the current release verified for this guide). Check that
it can run before handling a token:

```powershell
npx --yes @silvermoon-ai/connector@0.2.0 --help
```

### 2. Sign in and add a device

1. Open [silvermoon.work](https://silvermoon.work) and choose **Continue with
   Google**, **Continue with Microsoft** (personal Microsoft account), or
   **Continue with GitHub**.
   A Relay account is created on first sign-in.
2. Open the avatar menu, choose **Settings**, then under **Devices** choose
   **Add device**.
3. Enter a **Device name** and choose **Expires in days** (the default is 90).
   Submit **Add device**.
4. Use **Copy profile** before leaving Settings or refreshing. The generated
   profile contains your connection token; it will not be shown again.

Create a separate device/token for each Connector. Do not reuse a token for
two simultaneous connections. The name is managed in Relay, not by a CLI flag.

### 3. Configure the Connector securely

Do this on the agent's device. If you copied the profile elsewhere, transfer
it through a trusted private channel. Do not put it in a repository, chat,
screenshot, shell command history, or shared/cloud clipboard.

**Windows / PowerShell:** paste only the value after `token:` from the copied
profile into the hidden prompt below, not the whole YAML profile. This saves
the configuration with access restricted to the current Windows user and
then removes the temporary token from the shell environment:

```powershell
$secret = Read-Host "Connection token (the value after token:)" -AsSecureString
try {
    $env:SILVERMOON_CONNECTION_TOKEN = [System.Net.NetworkCredential]::new("", $secret).Password
    npx --yes @silvermoon-ai/connector@0.2.0 --relay https://relay.silvermoon.work --write-config
    if ($LASTEXITCODE -ne 0) { throw "Connector configuration failed; do not continue." }
} finally {
    Remove-Item Env:\SILVERMOON_CONNECTION_TOKEN -ErrorAction SilentlyContinue
    $secret.Dispose()
}
```

**macOS / Linux:** save the copied profile as
`~/.silvermoon/connector.yaml` with owner-only permissions. See the
[secure profile instructions](./packages/connector/README.md#save-a-profile-on-macos-or-linux)
for the exact steps.

After successful setup, clear the copied profile from your clipboard. The
default configuration is in `.silvermoon/connector.yaml` under your home
directory. It contains a secret: do not share it. If a profile already exists,
back it up securely before reconfiguring; the Connector refuses profiles
accessible to other users. Existing token environment variables override
the profile, so remove stale overrides before starting.

### 4. Start the Connector

In a terminal on the agent's device, change to the project directory you
want new Copilot Sessions to use, then run:

```powershell
npx --yes @silvermoon-ai/connector@0.2.0 --working-directory .
```

Keep this terminal running. In Relay, check **Settings > Devices** for the
device to become **online**, then choose **Back to Sessions**. Use **Ctrl+C**
in the terminal when you want to stop the Connector.

Do not add `--approve-all` just to get started. It automatically approves
Copilot permission requests for Connector-managed Sessions, allowing remote
instructions to run tools and change local files. It is an explicit opt-in
for a trusted environment, not a requirement for connecting a device.

### 5. Open or start a Session

The Session list's view-options menu remembers **Show completed**, **Show ended**, **Show unavailable**,
**Show offline Sessions**, and **Group by Device** in this browser for each account.
Your choices survive refreshes, browser restarts, and sign-out, and synchronize
across tabs signed in to the same account on the same site. They do not sync
across devices or save search, status filters, Session selection, or expanded
groups. If browser storage is unavailable, Relay shows a warning and keeps the
list usable; changes may not survive a refresh.

- **Existing Session:** select it from the Session list. On a narrow screen,
  use the list icon to open navigation. Read the message stream and, when
  sending is available, enter a **Follow-up message** and use **Send follow-up**
  (or Enter; Shift+Enter inserts a new line).
- **New Session:** choose **New Session**, select an online **Device**, enter
  a **First instruction** and optional **Title**, then choose **Start Session**.
  Once it appears in the list, open it to follow the response. For a first
  check, try a conversational instruction such as "Say hello and explain
  what you can help with" rather than a task that changes files.

Sending requires an online device and confirmed, writable Session
capabilities. A saved Session may have unknown execution state or be
read-only; its presence in the list is not a promise that it can run tools
or accept messages. Relay is not a general permission-approval interface.

## Complete and reactivate work

Use the small **Mark completed** check icon at the right of a Session list
item or at the top of its detail view to hide finished work from the daily
list. Hover or focus a row to see its action; detail actions stay visible.
On phones and touch screens, both actions stay visible with a touch target
of at least 44 by 44 CSS pixels. Enable **Show completed**
in Session view options to read completed history and use the **Reactivate**
return-arrow icon in the list or detail header to mark the same Session
unfinished again. You can complete and reactivate without leaving the detail
view; saved history and local drafts remain available. Existing search,
status, ended, unavailable and offline filters still apply.

This is an account-owned Relay work marker, shared across browsers and devices.
It does not stop or start the Agent, delete history, change native archives,
or cascade to parent or child Sessions. Connector updates and new events do
not reset it. A completed Session must be reactivated before sending another
follow-up; reactivation does not send a message or bypass online, capability
confirmation or native read-only restrictions. Ordinary offline Sessions can
be marked or reactivated; removed-device history stays read-only.

## Manage devices

In **Settings > Devices**, **Rename** changes the Relay display name without
changing the device ID, connection token or saved Sessions. Names are trimmed,
must contain 1–80 characters, and need not be unique. Reconnecting with an
existing Connector profile does not reset the name.

**Delete** removes the device from the usable device list, revokes every
associated token and requests immediate disconnection. If disconnection could
not be confirmed, use **Retry disconnect**; connection access is already
disabled, and the retry remains available after refreshing. Old profiles
cannot reconnect or restore the device. To use that computer again, choose
**Add device** and configure its Connector with the new profile. This creates
a new Relay identity; previous history is not merged into it.

Saved Sessions and messages stay attributed to the removed device. Enable
**Show offline Sessions** in the list's view-options menu and choose **All**
to find this read-only history. **Revoke** disables a particular token without
removing the device; **Rotate token** replaces a token for that same identity.

Deleting a Relay device does **not** delete local files, stop its local agent
or guarantee cancellation of work already sent. Stop the local Connector with
**Ctrl+C** to end its retry loop, and manage local agents separately. Queued
commands fail; commands already sent may have an unconfirmed result, so
inspect local work before repeating them.

## If something is not ready

- **Device stays offline:** check the Connector terminal for errors, local
  Copilot authentication, network access, and token expiry. Keep only one
  Connector running per token.
- **Token was lost or exposed:** in **Settings > Devices**, use **Rotate token**
  and securely configure the Connector with the new profile. Use **Revoke**
  to invalidate a token you no longer want to use.
- **VS Code Sessions are missing:** confirm Agent Host support, the same
  operating-system user, and that VS Code is running. Custom/portable installs
  may need `--vscode-user-data-dir`; see the [Connector guide](./packages/connector/README.md).
- **Sending is unavailable after reconnecting:** wait for state confirmation.
  If the UI reports a sync failure, use **Retry state sync**. Follow any
  Connector update prompt rather than assuming saved history is current state.
- **An offline Session is hidden:** enable **Show offline Sessions** in the
  list's view-options menu and use **All** to read saved history. Offline
  drafts are not automatically sent when the device reconnects.
- **A command result is unknown:** inspect the message stream before sending
  again; an unconfirmed result does not mean the operation never ran.

For other configuration options and troubleshooting, see the
[Connector guide](./packages/connector/README.md).

## Maintainers

For tag-triggered Connector publication, npm Trusted Publisher setup and
release validation, see [npm package releases](./docs/npm-package-releases.md).
