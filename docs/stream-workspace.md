# Read-only Stream workspace

The main `/` workspace lists device-owned Streams, grouped by Connector.
The Silvermoon brand, topbar, avatar, 19rem desktop rail and narrow-screen
list/detail navigation are retained. `/settings` keeps the existing account,
identity, device and token operations. The browser never receives a device
token for browsing; only explicit token creation/rotation in Settings reveals
the existing producer profile.

## Reading and following

- Initial selection reads **one page**, not the whole history. Pages contain at
  most 128 records and retain the sync protocol's 128KiB serialized batch bound.
- **Next page**, **Previous page**, **Latest history**, and **Locate** explicitly
  read history. Locate takes a canonical decimal sequence, including values
  beyond `2^53`; no sequence identity is converted to `Number`.
  Previous reads backwards from the exact first loaded sequence, and Latest
  reads backwards including the committed head. Neither subtracts an assumed
  128 records: byte-limited pages may contain just one event.
- **Follow from position** subscribes after the last processed sequence. Pausing
  closes the socket, preserving that cursor. Reconnection resumes from the same
  cursor; cache eviction does not advance it. To follow only new work, read
  **Latest history** first, then choose Follow.
  Processed ACKs are coalesced per delivery window (at most four per second),
  keeping catchup below the existing request quota. Retryable connection/output
  limits reconnect from that same processed cursor, not from the cache edge.
- The active data window holds at most **2,000 records** and **8MiB of original
  UTF-8 payload text**. These are cache limits, not a claim about total JS heap.
  Evicted pages can be reread through Previous or Locate. A detail selection
  closes if its record is evicted; it never displays another record's payload.
- Rows have fixed 44px previews, bounded overscan and actual sliced DOM
  rendering: at most **200 event row elements**, not `content-visibility`.
  Raw detail is separate; long JSON and opaque strings cannot expand rows.
  Paging preserves the visible sequence anchor when retained. Focusing the
  table pauses live movement; keyboard Home/End scroll the window. A focused
  event row is retained in the virtual DOM even outside the viewport, within
  the same 200-row limit.
  If an in-flight read evicts the focused record, focus explicitly returns to
  the table with a visible notice. Disjoint pages reset the data window with
  an explicit notice rather than joining across unread sequences. Manual reads
  set the resume cursor to the contiguous window's actual final record, so a
  Previous read cannot silently rewind a subscription into cached duplicates.
- Unknown/unversioned content types remain raw. The exact content-type registry
  is for bundled components only, currently empty in production. The test-only
  fixture proves selection, failure isolation and raw fallback, not delivery of
  a Supervisor view. Views receive only the bounded data window and controlled
  reads; they must not treat that window as full historical business state.
- Fetch, gap, copy, decode/render and authorization failures are visible.
  Empty logs are distinct from failed reads. “Sync online” comes from the
  actual generic writer lease, never the old Session connection state.

## Browser read API and authorization

All routes require the existing signed browser session cookie and the exact
configured `WEB_ORIGIN` header, with no-store credentialed CORS responses:

| GET route | Response |
| --- | --- |
| `/api/stream-connectors?after=…` | Up to 32 owned, nonremoved devices, sync writer status, next device id |
| `/api/stream-connectors/:device/streams?after=…` | Up to 32 streams, next stream id |
| `/api/stream-connectors/:device/events?streamId=…&after=0` | Bounded events, next decimal sequence and committed head |
| `/api/stream-connectors/:device/events?streamId=…&before=N` | Bounded contiguous preceding page, exact `after` boundary |
| `/api/stream-connectors/:device/events?streamId=…&tail=1` | Bounded latest page ending at the committed head |
| `/api/stream-connectors/:device/subscribe` | Cookie-authenticated WebSocket, existing v1 sync messages, **reader only** |

Worker routing resolves ownership before the stable
`JSON.stringify([accountId, deviceId])` Durable Object. The same existing SQLite
streams/events tables serve browser and `/v1/sync` device readers/writers.
Browser connections cannot negotiate writer, append or create a Stream.
They store a session id, never a device secret, and revalidate account/session
expiry/revocation/device removal on every operation, before fanout and on the
existing five-second alarm. As with device auth, this is not an atomic
cross-database revocation transaction: an operation authorized immediately
before revocation may complete first; subsequent delivery fails closed.

Inventory refresh runs five seconds after the preceding refresh finishes:
only one cancellable request chain is active. Refresh re-reads each explicitly
loaded device/stream prefix through its known final id, with a bounded
`ceil(loadedCount / 32) + 2` page budget for insertion drift. A budget overflow
or failed fetch retains the existing inventory and displays an error; it never
replaces a loaded prefix with just the first 32 entries. Updates commit
atomically, preserving selected identity, event component and processed cursor.
New streams and sync writer status changes appear without manual refresh.

Offline logs remain readable while the device belongs to the account. Removing
a device retains stored data but disables browser Stream access. Old Connector
endpoints and history are unchanged. `/legacy` and `/legacy/settings` retain the
Session UI and management; old root Session links show a compatibility link
rather than silently selecting an unrelated Stream.

## Run a real producer from this checkout (no npm publication)

Requires Node 22.13+, pnpm, an account/device profile from Settings, and a relay
running this implementation. Build the existing Connector:

```powershell
pnpm --filter @silvermoon-ai/connector build
```

Keep its profile protected using the existing
[Connector profile instructions](../packages/connector/README.md).
Never paste a device token into the browser console or include it in a URL,
command argument, source file or shell history. For a protected environment
prompt on Windows:

```powershell
$secret = Read-Host "Device token from your protected profile" -AsSecureString
try {
  $env:SILVERMOON_CONNECTION_TOKEN = [System.Net.NetworkCredential]::new("", $secret).Password
  # Optional: set SILVERMOON_SYNC_URL to your own wss://.../v1/sync endpoint.
  node scripts\stream-producer.mjs --init
} finally {
  Remove-Item Env:\SILVERMOON_CONNECTION_TOKEN -ErrorAction SilentlyContinue
  $secret.Dispose()
}
```

`--init` creates a new reliable SQLite source under ignored `.wrangler`.
It refuses to overwrite an existing source. For subsequent runs omit `--init`;
each run appends one observation and keeps synchronizing until Ctrl+C. Preserve
the database and WAL; missing local history is an error, not permission to
reinitialize the same device identity. `SILVERMOON_EVENT_SOURCE` can select a
protected persistent path. Do not run two writers for this device at once.
Select `checkout-observations` in the main workspace and read/follow it.
This example uses the checkout-built existing Connector sync export; no npm
release is necessary.

## Verification

```powershell
pnpm test:streams:smoke
pnpm check
pnpm --filter @silvermoon-ai/web test:browser --workers=4
```

The smoke creates random local account/device/session/token identities,
applies **all real D1 migrations**, uses the built Node producer over a real
WebSocket into local workerd/SQLite DO, and opens a locally served production
web build with a signed cookie. It checks history, raw detail, continuous
append, pause, offline reload, session revocation and resource counters.
No API is mocked, no production resources or credentials are used, and its
isolated state is removed on exit. It rebuilds the web bundle for its local
relay address; run the normal build afterward before any deployment.

Runtime tests include a 100,000-event actual SQLite history plus reads beyond
`2^53`. Browser tests use a 100,000-event paged fixture to exercise real virtual
DOM, cache eviction/reread, locate, anchors/focus and 64KiB UTF-8 payloads at
desktop/mobile/320px widths. Existing legacy Session tests remain active under
the documented compatibility paths; no coverage is skipped to accommodate
Streams. Production deployment remains a separate, approval-gated operation.
