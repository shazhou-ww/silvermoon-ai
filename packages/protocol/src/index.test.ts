import { describe, expect, it } from "vitest";
import {
  agentSessionSchema,
  agentSessionEventSchema,
  connectorCapabilitiesSchema,
  connectorCommandSchema,
  connectorIdSchema,
  PROTOCOL_VERSION,
  sessionWorkStateSchema,
} from "./index";

describe("relay protocol", () => {
  it("validates native archive capability, state and connection-scoped commands", () => {
    expect(connectorCapabilitiesSchema.parse({
      listSessions: true, createSession: true, sendMessage: true, streamEvents: true, setNativeArchive: true,
    }).setNativeArchive).toBe(true);
    expect(agentSessionSchema.parse({
      id: "native-session", title: null, status: "closed",
      createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
      nativeArchived: true, canSetNativeArchive: true, workState: "open",
    })).toMatchObject({ nativeArchived: true, canSetNativeArchive: true });
    expect(connectorCommandSchema.parse({
      type: "session.archive", protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(), sessionId: "native-session", archived: false,
    })).toMatchObject({ type: "session.archive", archived: false });
    expect(connectorCommandSchema.safeParse({
      type: "session.archive", protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(),
      sessionId: "native-session", archived: "false",
    }).success).toBe(false);
  });
  it("validates Relay work state without giving Connector observations authority over it", () => {
    expect(sessionWorkStateSchema.parse("completed")).toBe("completed");
    expect(sessionWorkStateSchema.safeParse("archived").success).toBe(false);
    expect(agentSessionSchema.parse({
      id: "session", title: null, status: "idle",
      createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z",
      workState: "open",
    })).not.toHaveProperty("workState");
  });

  it("accepts connector identities and complete capability sets", () => {
    expect(connectorIdSchema.parse("studio-laptop")).toBe("studio-laptop");
    expect(connectorCapabilitiesSchema.parse({
      listSessions: true,
      createSession: true,
      sendMessage: true,
      streamEvents: true,
    })).toEqual({
      listSessions: true,
      createSession: true,
      sendMessage: true,
      streamEvents: true,
    });
  });

  it("validates session commands and rejects blank prompts", () => {
    expect(
      connectorCommandSchema.safeParse({
        type: "session.create",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        prompt: "Inspect the failing build",
      }).success,
    ).toBe(true);
    expect(
      connectorCommandSchema.safeParse({
        type: "session.create",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        prompt: " ",
      }).success,
    ).toBe(false);
    expect(
      connectorCommandSchema.safeParse({
        type: "session.history",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        sessionId: "session-existing",
      }).success,
    ).toBe(true);
  });

  it("validates session activity observations", () => {
    expect(
      agentSessionEventSchema.safeParse({
        id: "event-1",
        sessionId: "session-1",
        sequence: 1,
        type: "message",
        role: "assistant",
        text: "Work is complete.",
        createdAt: "2026-10-10T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      agentSessionEventSchema.safeParse({
        id: "event-2",
        sessionId: "session-1",
        sequence: 2,
        type: "tool",
        text: "Tests succeeded",
        data: {
          turnId: "turn-1",
          partId: "tool-1",
          partIndex: 2,
          partKind: "tool",
          update: "snapshot",
          toolName: "Run tests",
          toolCallId: "tool-1",
          state: "succeeded",
        },
        createdAt: "2026-10-10T00:00:01.000Z",
      }).success,
    ).toBe(true);
    expect(
      agentSessionEventSchema.safeParse({
        id: "event-3",
        sessionId: "session-1",
        sequence: 3,
        type: "message",
        role: "assistant",
        text: "Done.",
        data: {
          turnId: "turn-1",
          partId: "part-1",
          partIndex: -1,
          partKind: "markdown",
        },
        createdAt: "2026-10-10T00:00:02.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts legacy sessions and optional parent relationships", () => {
    const legacySession = {
      id: "session-1",
      title: "Parent session",
      status: "idle",
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:01:00.000Z",
    };
    expect(agentSessionSchema.parse(legacySession)).toMatchObject({
      ...legacySession,
      lastMessagePreview: null,
    });
    expect(agentSessionSchema.parse({
      ...legacySession,
      id: "session-2",
      parentSessionId: "session-1",
      canSendMessage: false,
      pendingInputRequest: {
        id: "input-1",
        message: "Choose a target.",
        url: null,
        questions: [{
          id: "target",
          kind: "single-select",
          message: "Where should I deploy?",
          options: [
            { id: "staging", label: "Staging", recommended: true },
            { id: "production", label: "Production" },
          ],
        }],
      },
    })).toMatchObject({
      id: "session-2",
      parentSessionId: "session-1",
      canSendMessage: false,
      pendingInputRequest: {
        id: "input-1",
        questions: [
          expect.objectContaining({ kind: "single-select" }),
        ],
      },
    });
  });

  it("rejects unsupported versions and invalid connector identities", () => {
    expect(
      connectorCommandSchema.safeParse({
        type: "sessions.list",
        protocolVersion: 1,
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(connectorIdSchema.safeParse("../connector").success).toBe(false);
  });
});
