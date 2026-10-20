# Account messages and the generic Device connector (v2)

The Relay v2 endpoints were deployed to production on **2026-10-20**.
The library/CLI remain a checkout capability, **not a new npm release**.
This adds an independent `@silvermoon-ai/connector/duplex` entrypoint and
`silvermoon-duplex` validation executable. Existing AHP/tRPC entrypoints,
`/v1/sync`, multi-stream archives and browser pages are unchanged.

## Production rollout and trying it

- Source: [`8bb1e8072242`](https://github.com/shazhou-ww/silvermoon-ai/commit/8bb1e8072242997241dff078d79ee6321d65f530).
  The existing [release workflow](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/39444769096)
  passed full checks, 241 browser tests (2 skipped), remote D1 migration
  verification, Worker deployment and Pages deployment.
- Relay: <https://relay.silvermoon.work>; frontend: <https://silvermoon.work>.
  Worker version `875a4196-d982-46b8-b072-b3e03d993c86` was observed at 100%.
  The new `AccountMessages` binding/class is additive; D1 had no pending
  migrations. Existing `DeviceSync`/`DaemonSession` and old history remain.
- Production probes after deployment: `/health` returned 200; unauthenticated
  v2 Client/Device endpoints returned the expected `401 unauthorized`;
  frontend `/` and `/legacy` returned 200. An actual browser on the frontend
  could read both the v2 and legacy 401 responses, verifying the CORS boundary.
  These checks did not create devices, submit messages or alter existing data.
- Worker logs remain enabled; traces are explicitly enabled with 1% head
  sampling. Online Cloudflare documentation was unavailable during preflight;
  command/config compatibility was checked against installed Wrangler 4.147.0,
  its schema/help, generated types, dry-run and the successful release workflow.

For an authenticated trial, sign in on the frontend and create a separate test
Device in Settings. Keep its credential in a protected local file, never chat,
source, console output or shell arguments. Use the checkout-built CLI described
below with that Device and `https://relay.silvermoon.work`; do not assume the
currently published npm package contains the new entrypoint. Use the Client
API from the signed-in frontend origin, explicitly enable the session's write
access, then submit a harmless test payload to that Device. Observe it with
CLI `receive`; printing must leave it pending until explicit `ack`. Enqueue
and flush an upstream event, then read it through the account Client endpoint.

The existing web workspace still displays v1 Streams: this rollout did not add
v2 send/receive controls. Actual authenticated end-to-end production testing
requires the user's sign-in and test-Device setup; it is not claimed by the
unauthenticated probes above. Existing test devices/history must not be reused
or deleted as cleanup. The real target host has not yet been integrated, and
production capacity/retention/disaster recovery are not established by rollout.

## Identity, ordering and persistence

The existing user ID is the Account ID; existing Device IDs and connection
tokens are reused. Connector is a library, not another registered identity.
Clients and Devices associate through Account only.

One SQLite-backed `AccountMessages` Durable Object per Account owns one
append-only `messages` table for **both** directions. Its business record is:

```ts
type Message = {
  id: string;          // canonical decimal, signed 64-bit range
  account_id: string;
  device_id: string;   // upstream source or downstream target
  is_upstream: boolean;
  payload: JsonValue;  // opaque bounded JSON; no task/producer requirement
};
```

IDs are **account-scoped**, never globally comparable and never per-Device
counters merged into an account cursor. A persisted account binding guards
each object. Use `(account_id, id)` for a cross-account host receipt key.
`INTEGER PRIMARY KEY AUTOINCREMENT` allocates IDs; every wire/storage boundary
that crosses JavaScript reads IDs using `CAST(... AS TEXT)`, not Number.
Append, quota checks and stable request-key mapping commit in one synchronous
SQLite transaction. There is no await between allocation and commit, so a
published higher cursor cannot skip a lower pending commit. Failed transactions
publish neither an ID nor its mapping. Gaps are valid; published IDs are not
reused. IDs order Relay storage, not occurrence, causality, execution or
external side effects.

Each submission is `{key, payload}`. Generate and persist the random
16–128-character `[A-Za-z0-9_-]` key **before** sending. The account-wide
mapping binds it to stable authenticated producer scope, target, direction
and canonical JSON. An exact retry, including after session/token rotation,
returns `{status:"accepted",id}`. Changed target/content/producer/direction
returns `idempotency_conflict`. A lost response must never cause key replacement.
Object key order is insignificant; array order is significant.

Authentication is rechecked against D1 on **every** operation and at most
250 ms between long-poll checks. The authorization lookup admits the overlapping
operation; its final synchronous transaction fences ownership. A revocation
that has completed before a new authorization lookup rejects that request.
There is no distributed transaction between D1 revocation and DO storage:
an already-admitted overlapping operation may finish. Completed removals,
token revocation and deleted Accounts deny subsequent operations and waiting
polls. Fencing cannot retract messages or external side effects already handed
to a host.

## HTTP contract

All responses are JSON with `cache-control: no-store`. IDs/cursors are decimal
strings. Requests supply no trusted Account or direction.

### Client (browser session cookie only)

Every request requires the configured exact Web Origin. POST additionally
requires the existing matching `sm_csrf` cookie and `x-csrf-token` header.
Device Bearer credentials are never accepted as browser credentials.

| Operation | Request |
| --- | --- |
| Explicitly enable/disable this session's v2 write capability | `POST /api/v2/account/write-access` `{enabled:true\|false}` |
| Submit to exactly one owned, active Device | `POST /api/v2/devices/{deviceId}/regulations` `{key,payload}` |
| Read/long-poll **all** Account Device events | `GET /api/v2/account/events?after=0&wait=20000` |

An existing login/legacy read subscription does not automatically opt into
v2 writes. The account owner explicitly grants the current authenticated
session through the CSRF-protected write-access operation; no new Client
registration, identity or Client–Device pairing is created. The repository
currently models owner sessions, not delegated read-only user roles. A future
delegated session system must check its own owner-grant authority here.
Session revocation/expiry always overrides a stored write grant.

Both Clients in one Account independently read the same upstream history,
including autonomous events and newly added Devices, regardless of which
Client submitted a regulation. No Client ACK truncates another's history.
Persist each Client's own `next` only after its own durable handling; use it
with the same Account/direction on reconnect. There is no shared server-side
Client cursor.

### Device (connection-token Bearer only)

The credential must match the path Device and have `daemon:connect` scope.
Browser cookies confer no Device authority. Writes are single-message short
HTTP requests, not unbounded batches.

| Operation | Request |
| --- | --- |
| Acquire lease | `POST /v2/devices/{id}/lease` `{action:"acquire",owner,takeover:false}` |
| Renew/release lease | same path, `{action:"renew"\|"release",owner}` |
| Report upstream event | `POST /v2/devices/{id}/events` `{key,payload}` |
| Receive own regulations | `GET /v2/devices/{id}/regulations?after=0&wait=20000` |
| Report cumulative **host durable receipt**, not execution | `POST /v2/devices/{id}/ack` `{id}` |

Owner is a random 16–128-character instance nonce, not business identity.
Acquire returns `{generation,owner,expires,ack}`; include
`x-device-owner` and `x-device-generation` thereafter. The 60-second lease
fences append, read (including waiting polls), ACK, renew and release.
Normal acquisition conflicts with another unexpired owner; takeover requires
explicit `takeover:true`. A lost acquire response retried by the same owner
does not acquire another generation. Credential rotation does not change the
owner or Device. After expiry/replacement an old generation fails explicitly;
it cannot silently resume or schedule more work.

Reads return `{messages,next,retained_after}`. Long polling is the real-time
subscription transport: repeatedly issue a bounded poll from the last durable
cursor, with no per-Device enumeration for Clients. Empty results preserve
`after`; a full page advances only to its last matching message. The synchronous
append and indexed read share the same account ordering authority, so the
history/real-time boundary needs no ephemeral notification to avoid gaps.
Each independent request has its own window; one slow Client does not block
the others.

## Embedding

Requires Node **22.13+** for built-in SQLite (experimental on Node 22).
Import and construction do not open files, read environment variables, log,
start network I/O or register process handlers.

```ts
import { DeviceConnector } from "@silvermoon-ai/connector/duplex";

const connector = new DeviceConnector({
  relayUrl: "https://your-authorized-relay.example",
  accountId: accountIdFromHostConfig,
  deviceId: existingDeviceId,
  statePath: stablePrivateSqlitePath,
  token: () => hostCredentialProvider.currentToken(), // invoked for each request
});
await connector.initialize({ create: true }); // first use ONLY; omit create on restart
const queued = connector.enqueue({ status: "locally-observed" });
// queued.status === "queued": local WAL/FULL commit, NOT Relay acceptance.
await connector.start();
const accepted = await connector.flush(); // [{status:"accepted", key, id}]
const messages = await connector.receive(20_000);
for (const message of messages) {
  await hostDurableReceiptStore.persistIfAbsent(message.account_id, message.id, message);
  await connector.acknowledge(message.id);
}
await connector.stop(); // host owns signals and process exit
```

The host explicitly schedules calls to `renew`, `flush` and `receive`; there
is no hidden background process. Renew well within 60 seconds (for example
every 20 seconds), including while the host does long business work. Network
requests retry at most three attempts with 100/200 ms backoff and a maximum
30-second deadline per attempt (default 25 seconds). The credential supplier
is deadline-bounded too. HTTPS is required except for loopback local tests;
redirects are rejected so credentials cannot follow a redirect.

`enqueue` works offline after local initialization. Outbox key/JSON/remote ID,
inbox, receipt flags and durable receive cursor survive restart. A local
SQLite owner claim fences competing processes using the same state file;
claim takeover is explicit while the previous claim remains active.
State reads are diagnostic only; `pending()` is an inspection/redelivery
view, not permission to execute offline side effects. `receive()` rechecks
the Relay lease before handing pending work to the host.
If a different-state remote instance takes over while this host is offline,
the host cannot learn that fact without contacting Relay; known fencing
blocks mutations, and **all remote progress remains fenced**. Offline
autonomous work must follow the host's own previously authorized policy.

Receive commits inbox and cursor **before** returning. Returning/awaiting a
callback, printing, or successfully persisting the connector inbox does not
ACK. ACK is explicit after host durable receipt and ordered across unacknowledged
messages; it does not assert execution success. A crash after host receipt but
before ACK redelivers: deduplicate in the host using `(account_id,id)`.
Execution results/cancellations are new opaque payload events. Unknown
external side effects require reconciliation, business idempotency or fencing
at the external resource, never automatic execution replay.

`initialize()` fails on missing/corrupt/wrong-identity state. Do not recover by
silently creating another database. A remote host-ACK beyond the local cursor
also reports local state loss. Keep the complete original databases and
credential-independent identity through restarts/upgrades. `stop()` cancels
an active request or retry backoff and rejects older queued operations,
attempts release and closes local state even when offline;
release errors remain explicit and the remote lease expires naturally.
If startup detects a remote durable ACK ahead of local history, that instance
is permanently fail-closed: `state()` reports `started:false,fenced:true`,
and only diagnostic state/stop remain available. Catching the startup error
cannot resume reads, writes, ACKs or local enqueue; even stop/reinitialize does
not clear that instance's failure. Recover verified state explicitly and use a
new instance, never silently reset the cursor. An acquired lease from failed
startup is not used for progress and expires naturally.

[Ordinary host fixture](../packages/connector/examples/duplex-host.mjs) persists
receipts in a caller-owned SQLite database before calling the same public ACK
API. The caller must open that host database with its required durable
transaction settings (the smoke uses WAL/FULL). It never executes payloads and
is **not** an implemented `objective-portfolio-supervisor` integration.

## Thin validation CLI

After building this checkout, invoke
`node packages\connector\dist\duplex-cli.js <command> <config.json> [value]`
or its package bin `silvermoon-duplex`. Commands are `init`, `state`, `enqueue`,
`send`, `flush`, `receive`, `ack`. `enqueue` is offline durable submission;
`send` queues then acquires/flushes a bounded page. `flush` resumes original
keys after a previous uncertain submission; do not rerun `send` with a new key
as a lost-response recovery mechanism. `receive` prints unacknowledged
messages but **does not ACK**; only `ack <id>` does.

Config contains `relayUrl`, `accountId`, `deviceId`, `statePath`, `tokenFile`.
Protect it, the credential file and both databases; never commit them. Token
content is read only for actual network calls and is never printed. Stdout
is JSONL only; errors are JSON diagnostics on stderr with a nonzero exit.
There is no localhost service, pipe execution engine or duplicate CLI transport.

## Bounds, failures and retention

| Bound | Value |
| --- | --- |
| Payload / HTTP request | 16 KiB canonical UTF-8 JSON / 20 KiB raw body |
| Read window / long-poll lifetime | 32 messages / 20 seconds |
| Concurrent polls / request admission | 4 per authenticated principal / 600 per minute |
| Account retained messages / payload | 50,000 / 64 MiB |
| Per-Device retained messages / payload | 10,000 / 16 MiB |
| Local inbox + outbox (including receipt/mapping evidence) | 10,000 records / 32 MiB |

There is **no automatic retention cleanup**, no public purge endpoint and no
TTL on idempotency evidence in this version. The retry window is the lifetime
of the retained account log/mapping, bounded by the quotas: reaching a quota
halts new submissions, never silently deletes history or reaccepts an old key.
Duplicates still resolve at full storage quota. Local accepted/ACKed evidence
is likewise retained and eventually backpressures; archival/compaction needs a
separately reviewed retention implementation, not manual database replacement.
Scale/capacity beyond these bounds is not claimed.

`retained_after` is an explicit coordinated retention boundary, initially `0`;
holes do not expire cursors. If that boundary advances under a future authorized
cleanup, older cursors fail `410 cursor_expired` with the boundary rather than
skipping regulation. `409 cursor_ahead` fails future cursors. Recovery from an
expired cursor, restored/rolled-back Relay backup, lost local state or unknown
external execution requires explicit host/operator reconciliation; no automatic
rebase/renumber is provided. Advancing retention or restoring a Relay backup is
not an implemented/administered operation of this change.

Errors include `401 unauthorized`, `403 forbidden`/`write_permission_required`,
`404 device_not_found`, `409 stale_generation`/`lease_conflict`/
`idempotency_conflict`, `410 cursor_expired`, `413 payload_too_large`,
`429 rate_limited`/`backpressure`/`quota_exceeded`, and `503 relay_unavailable`.
Responses explicitly carry `retryable`; quotas/conflicts/expired cursors are
not silently retried. Local errors include `local_state_unavailable`,
`local_state_mismatch`, `local_state_lost`, `local_lease_conflict`,
`local_backpressure` and `ack_out_of_order`.
Unexpected storage/RPC failures produce structured server diagnostics with
fixed event/operation context (and the DO's opaque object ID when applicable),
then explicit `relay_unavailable`; expected protocol rejections stay quiet.
Diagnostics omit raw exception messages, request URLs/queries, credentials,
submission keys and payloads, since storage error text can embed private data.

## Compatibility and local proof

No old account/device/stream/seq ID, `token-*` migration origin or history
record is renumbered, merged or imported into executable regulations.
Old APIs, stream tables, token/removal semantics and UI remain in v1.

`pnpm test:duplex:smoke` builds locally (Worker dry-run only), starts an isolated
loopback Miniflare/workerd runtime with random test-only credentials and all
real D1 migrations, exercises the built library, then restarts the full
runtime and local databases. It tests real HTTP deduplication, 2x2 routing,
account broadcast, new-device inclusion, token rotation and durable host ACK.
It stops all helpers and removes only its own project-local state. It performs
no deployment, publishing or production reads/writes.
