import { describe, expect, it } from "vitest";
import { canonicalPayload, messageIdSchema, submissionSchema } from "./duplex";

describe("duplex v2 wire contract", () => {
  it("keeps signed 64-bit IDs as canonical decimal strings without Number coercion", () => {
    for (const id of ["0", "9007199254740993", "9223372036854775807"]) expect(messageIdSchema.parse(id)).toBe(id);
    for (const id of ["01", "-1", "9223372036854775808", "1e3", 1]) expect(messageIdSchema.safeParse(id).success).toBe(false);
  });
  it("canonicalizes opaque JSON and enforces bounded, independent submission metadata", () => {
    expect(canonicalPayload({ b: [null, { z: true, a: 2 }], a: "x" }))
      .toBe(canonicalPayload({ a: "x", b: [null, { a: 2, z: true }] }));
    expect(submissionSchema.safeParse({ key: "stable-request-key", payload: null }).success).toBe(true);
    expect(submissionSchema.safeParse({ key: "short", payload: {} }).success).toBe(false);
    expect(submissionSchema.safeParse({ key: "stable-request-key", payload: {}, task_ref: "mandatory?" }).success).toBe(false);
    expect(() => canonicalPayload("中".repeat(6000))).toThrow("payload_too_large");
  });
});
