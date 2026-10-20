import { describe, expect, it } from "vitest";
import { LIMITS, MAX_SEQ, eventSchema, parseClientMessage, seqSchema, serverMessageSchema, utf8Bytes } from "./index";

describe("generic sync wire contract", () => {
  it.each(["-1", "+1", "01", "1.0", "1e3", " 1", "", "9223372036854775808"])("rejects noncanonical/overflow sequence %s", (seq) => {
    expect(seqSchema.safeParse(seq).success).toBe(false);
  });
  it("supports exact integer positions beyond JS precision", () => {
    expect(seqSchema.parse(MAX_SEQ.toString())).toBe("9223372036854775807");
    expect(eventSchema.safeParse({ seq: "0", payload: "" }).success).toBe(false);
    expect(seqSchema.parse("0")).toBe("0");
  });
  it("rejects unknown fields, bad payload UTF-16, oversized frames and batches", () => {
    const append = (payload: string) => JSON.stringify({ type: "stream.append", requestId: "r", streamId: "s", events: [{ seq: "1", payload }] });
    expect(() => parseClientMessage(append("\ud800"))).toThrow("invalid_message");
    expect(() => parseClientMessage(append("文".repeat(22_000)))).toThrow("payload_too_large");
    expect(() => parseClientMessage(append("\0".repeat(30_000)))).toThrow("payload_too_large");
    expect(() => parseClientMessage(" ".repeat(LIMITS.frameBytes + 1))).toThrow("payload_too_large");
    expect(() => parseClientMessage(JSON.stringify({ type: "ping", requestId: "r", userId: "forged" }))).toThrow();
    expect(() => parseClientMessage(JSON.stringify({
      type: "stream.append", requestId: "r", streamId: "s",
      events: Array.from({ length: 3 }, (_, i) => ({ seq: String(i + 1), payload: "x".repeat(60_000) })),
    }))).toThrow("payload_too_large");
  });
  it("preserves opaque strings and accounts encoded bytes rather than string length", () => {
    const payload = '{"z": 1, "a":"🎉"}\n';
    const message = parseClientMessage(JSON.stringify({ type: "stream.append", requestId: "r", streamId: "s", events: [{ seq: "1", payload }] }));
    expect(message.type === "stream.append" && message.events[0].payload).toBe(payload);
    expect(utf8Bytes("🎉")).toBe(4);
  });
  it("validates error recovery positions and scopes", () => {
    expect(serverMessageSchema.parse({ type: "error", requestId: "r", code: "sequence_gap", expected: "7", message: "expected 7", retryable: false }).type).toBe("error");
    expect(serverMessageSchema.safeParse({ type: "stream.appended", requestId: "r", streamId: "s", committedThrough: 2 }).success).toBe(false);
  });
});
