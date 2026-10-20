# @silvermoon-ai/sync-protocol (private)

Platform-neutral version 1 contract for `/v1/sync`: Zod schemas, strict
decimal positions, immutable opaque UTF-8 event strings, resource limits,
client/server messages, and explicit recovery errors. No Node, Cloudflare,
Session, Supervisor, transport, or persistence implementation belongs here.

Runtime users are the Worker's `DeviceSync` and the existing Connector's
separate `./sync` export. The public Connector bundles this workspace's
runtime code and declarations. Do not publish this package as a separate SDK.

See [event-stream-sync.md](../../docs/event-stream-sync.md) for the wire and
recovery contract, finite retention quota, and reproducible runtime validation.
