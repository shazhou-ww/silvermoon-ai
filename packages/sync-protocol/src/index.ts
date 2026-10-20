import { z } from "zod";

export const SYNC_VERSION = 1 as const;
export const MAX_SEQ = 9_223_372_036_854_775_807n;
export const LIMITS = Object.freeze({
  frameBytes: 256 * 1024,
  payloadBytes: 64 * 1024,
  batchBytes: 128 * 1024,
  batchEvents: 128,
  streams: 128,
  connections: 8,
  subscriptions: 8,
  windowBytes: 256 * 1024,
  windowEvents: 128,
  quotaBytes: 64 * 1024 * 1024,
  quotaEvents: 1_000_000,
  leaseMs: 60_000,
  handshakeMs: 10_000,
  slowReaderMs: 60_000,
  authCheckMs: 5_000,
  inFlightRequests: 16,
  requestsPerPeriod: 64,
  connectionOutputBytes: 4 * 1024 * 1024,
});
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
export function validUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export const seqSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u)
  .refine((value) => /^(0|[1-9][0-9]{0,18})$/u.test(value) && BigInt(value) <= MAX_SEQ, "sequence overflow");
export const eventSchema = z.object({
  seq: seqSchema.refine((value) => value !== "0", "events start at 1"),
  payload: z.string().refine(validUnicode, "invalid UTF-8 string")
    .refine((value) => utf8Bytes(value) <= LIMITS.payloadBytes, "payload_too_large"),
}).strict().refine((event) => utf8Bytes(JSON.stringify(event)) + 2 <= LIMITS.batchBytes, "payload_too_large");
export type EventRecord = z.infer<typeof eventSchema>;
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const contentTypeSchema = z.string().min(1).max(256).refine(validUnicode);
const request = { requestId: idSchema };
const stream = { ...request, streamId: idSchema };
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), ...request, version: z.number().int(), role: z.enum(["writer", "reader"]) }).strict(),
  z.object({ type: z.literal("ping"), ...request }).strict(),
  z.object({ type: z.literal("stream.open"), ...stream, contentType: contentTypeSchema.optional() }).strict(),
  z.object({ type: z.literal("stream.list"), ...request, after: idSchema.optional(), limit: z.number().int().min(1).max(LIMITS.streams).default(32) }).strict(),
  z.object({ type: z.literal("stream.append"), ...stream, events: z.array(eventSchema).min(1).max(LIMITS.batchEvents) }).strict(),
  z.object({ type: z.literal("stream.read"), ...stream, after: seqSchema, limit: z.number().int().min(1).max(LIMITS.batchEvents).default(64) }).strict(),
  z.object({ type: z.literal("stream.subscribe"), ...stream, subscriptionId: idSchema, after: seqSchema }).strict(),
  z.object({ type: z.literal("subscription.ack"), ...request, subscriptionId: idSchema, through: seqSchema }).strict(),
  z.object({ type: z.literal("subscription.cancel"), ...request, subscriptionId: idSchema }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export const errorCodeSchema = z.enum([
  "unsupported_version", "invalid_message", "payload_too_large", "quota_exceeded",
  "unauthorized", "forbidden", "writer_busy", "stale_connection", "handshake_required",
  "stream_not_found", "event_conflict", "sequence_gap", "invalid_cursor",
  "invalid_ack", "subscription_not_found", "content_type_conflict", "slow_consumer",
  "resubscribe_required", "storage_error", "source_history_unavailable", "local_state_lost",
  "cursor_expired", "history_unverifiable",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export class SyncError extends Error {
  constructor(public readonly code: ErrorCode, message: string = code, public readonly retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = "SyncError";
  }
}
const range = {
  streamId: idSchema,
  committedThrough: seqSchema,
  retainedFrom: seqSchema.nullable(),
  contentType: z.string().optional(),
};
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), ...request, version: z.literal(SYNC_VERSION), connectionId: z.string(), generation: seqSchema, limits: z.record(z.string(), z.number()) }).strict(),
  z.object({ type: z.literal("pong"), ...request }).strict(),
  z.object({ type: z.literal("stream.opened"), ...request, ...range }).strict(),
  z.object({ type: z.literal("stream.listed"), ...request, streams: z.array(z.object(range).strict()), next: idSchema.nullable() }).strict(),
  z.object({ type: z.literal("stream.appended"), ...request, streamId: idSchema, committedThrough: seqSchema }).strict(),
  z.object({ type: z.literal("stream.events"), ...request, streamId: idSchema, events: z.array(eventSchema), next: seqSchema, committedThrough: seqSchema }).strict(),
  z.object({ type: z.literal("subscription.ready"), ...request, subscriptionId: idSchema }).strict(),
  z.object({ type: z.literal("subscription.events"), subscriptionId: idSchema, streamId: idSchema, events: z.array(eventSchema), caughtUpThrough: seqSchema }).strict(),
  z.object({ type: z.literal("subscription.acked"), ...request, subscriptionId: idSchema, through: seqSchema }).strict(),
  z.object({ type: z.literal("subscription.cancelled"), ...request, subscriptionId: idSchema }).strict(),
  z.object({ type: z.literal("error"), requestId: idSchema.optional(), subscriptionId: idSchema.optional(), streamId: idSchema.optional(), code: errorCodeSchema, message: z.string().max(1024), retryable: z.boolean(), expected: seqSchema.optional() }).strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export function parseClientMessage(text: string): ClientMessage {
  if (text.length > LIMITS.frameBytes || utf8Bytes(text) > LIMITS.frameBytes) throw new SyncError("payload_too_large");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SyncError("invalid_message"); }
  const parsed = clientMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new SyncError(parsed.error.issues.some((issue) => issue.message === "payload_too_large") ? "payload_too_large" : "invalid_message");
  }
  if (parsed.data.type === "stream.append"
    && utf8Bytes(JSON.stringify(parsed.data.events)) > LIMITS.batchBytes) {
    throw new SyncError("payload_too_large");
  }
  return parsed.data;
}
export function eventBytes(event: EventRecord): number {
  return utf8Bytes(JSON.stringify(event));
}
