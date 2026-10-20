import { z } from "zod";

export const DUPLEX_VERSION = 2;
export const DUPLEX_LIMITS = Object.freeze({
  payloadBytes: 16_384, requestBytes: 20_480, page: 32, leaseMs: 60_000,
  waitMs: 20_000, subscriptions: 4, requestsPerMinute: 600,
  accountMessages: 50_000, accountBytes: 64 * 1024 * 1024,
  deviceMessages: 10_000, deviceBytes: 16 * 1024 * 1024,
  localMessages: 10_000, localBytes: 32 * 1024 * 1024,
});
export const MAX_MESSAGE_ID = 9_223_372_036_854_775_807n;
export const messageIdSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u)
  .refine(value => /^(0|[1-9][0-9]{0,18})$/u.test(value) && BigInt(value) <= MAX_MESSAGE_ID);
export const submissionSchema = z.object({
  key: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/u),
  payload: z.json(),
}).strict();
export const messageSchema = z.object({
  id: messageIdSchema, account_id: z.string(), device_id: z.string(),
  is_upstream: z.boolean(), payload: z.json(),
}).strict();
export const pageSchema = z.object({
  messages: z.array(messageSchema).max(DUPLEX_LIMITS.page),
  next: messageIdSchema, retained_after: messageIdSchema,
});
export type Message = z.infer<typeof messageSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type MessagePage = z.infer<typeof pageSchema>;
export type DuplexFailure = {
  error: string; retryable: boolean; retained_after?: string;
};
export class DuplexError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retainedAfter?: string;
  constructor(code: string, retryable = false, retainedAfter?: string) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.retainedAfter = retainedAfter;
    this.name = "DuplexError";
  }
}
export function canonicalPayload(payload: Submission["payload"]): string {
  const sort = (value: Submission["payload"]): Submission["payload"] => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
    }
    return value;
  };
  const text = JSON.stringify(sort(payload));
  if (new TextEncoder().encode(text).byteLength > DUPLEX_LIMITS.payloadBytes) throw new DuplexError("payload_too_large");
  return text;
}
