import { describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { agentSessionSchema, agentSessionEventSchema, PROTOCOL_VERSION } from "@silvermoon-ai/protocol";
import { sessionSyncSchema } from "@silvermoon-ai/rpc";
import type { AgentAdapter, AgentAdapterEvent } from "./adapter.js";
import { SilvermoonConnector } from "./connector.js";

const frameSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.object({ path: z.string(), input: z.unknown().optional() }).optional(),
});
const summary = {
  id: "session", title: "Current", status: "running" as const,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
  lastMessagePreview: null,
  executionStateKnown: true,
  canSendMessage: true,
};

async function fixture(options: { failFirst?: boolean; failCompletions?: number; deferMessage?: boolean } = {}) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a local TCP listener.");
  let connectionId = "";
  const calls: Array<{ path: string; input: unknown }> = [];
  const logs: string[] = [];
  let socket: WebSocket | undefined;
  let subscriptionId: string | number | undefined;
  let completionFailures = options.failCompletions ?? 0;
  server.on("connection", (connection) => {
    const issuedConnectionId = crypto.randomUUID();
    connectionId = issuedConnectionId;
    socket = connection;
    connection.on("message", (data) => {
      if (String(data) === "PING") { connection.send("PONG"); return; }
      const decoded: unknown = JSON.parse(String(data));
      for (const raw of Array.isArray(decoded) ? decoded : [decoded]) {
        const frame = frameSchema.parse(raw);
        if (frame.method === "subscription.stop") continue;
        if (!frame.params) throw new Error("RPC request parameters are missing.");
        calls.push({ path: frame.params.path, input: frame.params.input });
        if (frame.method === "subscription") {
          subscriptionId = frame.id;
          connection.send(JSON.stringify({ id: frame.id, result: { type: "started" } }));
          continue;
        }
        if (frame.params.path === "commandCompleted" && completionFailures > 0) {
          completionFailures -= 1;
          connection.send(JSON.stringify({
            id: frame.id,
            error: {
              message: "Temporary result upload failure", code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "commandCompleted" },
            },
          }));
          continue;
        }
        connection.send(JSON.stringify({
          id: frame.id,
          result: {
            type: "data",
            data: frame.params.path === "register"
              ? { connectionId: issuedConnectionId, connectorId: "test-device", protocolVersion: PROTOCOL_VERSION }
              : { ok: true },
          },
        }));
      }
    });
  });
  let listener: ((event: AgentAdapterEvent) => void) | undefined;
  let lists = 0;
  let resolveMessage: (() => void) | undefined;
  const messages: string[] = [];
  const adapter: AgentAdapter = {
    agent: { name: "Test" },
    capabilities: { listSessions: true, createSession: true, sendMessage: true, streamEvents: true },
    async listSessions() {
      lists += 1;
      if (options.failFirst && lists === 1) throw new Error("Catalog temporarily unavailable");
      listener?.({ type: "session.updated", session: { ...summary, title: "Observed during inventory", status: "waiting" } });
      listener?.({
        type: "session.event",
        event: {
          id: `saved-${lists}`, sessionId: "session", sequence: lists,
          type: "status", status: "waiting", createdAt: summary.createdAt,
        },
      });
      return [summary];
    },
    async createSession() { return summary; },
    async sendMessage(input) {
      messages.push(input.message);
      if (options.deferMessage) await new Promise<void>((resolve) => { resolveMessage = resolve; });
    },
    async loadSessionHistory() { return []; },
    subscribe(callback) {
      listener = callback;
      callback({ type: "session.updated", session: { ...summary, title: "Buffered before registration" } });
      return () => { listener = undefined; };
    },
  };
  const connector = new SilvermoonConnector({
    relayUrl: `http://127.0.0.1:${address.port}`,
    token: "fictional-test-token", adapter, heartbeatMs: 20,
    log: (message) => logs.push(message),
  });
  connector.start();
  return {
    calls, logs, messages,
    get connectionId() { return connectionId; },
    disconnect() {
      if (!socket) throw new Error("No connector socket.");
      socket.close(1012, "Simulated restart");
    },
    finishMessage() {
      if (!resolveMessage) throw new Error("No message execution is waiting.");
      resolveMessage();
    },
    emit(event: AgentAdapterEvent) { listener?.(event); },
    sendListCommand(commandId: string) {
      if (!socket || subscriptionId === undefined) throw new Error("Command subscription is not ready.");
      socket.send(JSON.stringify({
        id: subscriptionId,
        result: {
          type: "data",
          data: { type: "sessions.list", commandId, connectionId, protocolVersion: PROTOCOL_VERSION },
        },
      }));
    },
    sendMessageCommand(commandId: string) {
      if (!socket || subscriptionId === undefined) throw new Error("Command subscription is not ready.");
      socket.send(JSON.stringify({
        id: subscriptionId,
        result: { type: "data", data: {
          type: "session.message", commandId, connectionId, protocolVersion: PROTOCOL_VERSION,
          sessionId: "session", message: "Execute only once",
        } },
      }));
    },
    async close() {
      await connector.stop();
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("connection-scoped connector uploads", () => {
  it("supersedes old snapshots but retains observations made during inventory and historical events", async () => {
    const relay = await fixture();
    try {
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "sessionEvent")).toBe(true));
      const inventory = sessionSyncSchema.parse(relay.calls.find((call) => call.path === "syncSessions")?.input);
      expect(inventory.observation?.connectionId).toBe(relay.connectionId);
      expect(inventory.sessions[0]).toMatchObject({ title: "Current", status: "running" });
      const updateSchema = z.object({
        session: agentSessionSchema,
        observation: z.object({ connectionId: z.uuid(), sequence: z.number() }),
      });
      const duringInventory = updateSchema.parse(relay.calls.find((call) => call.path === "sessionUpdated")?.input);
      expect(duringInventory.session.title).toBe("Observed during inventory");
      expect(duringInventory.observation.sequence).toBeGreaterThan(inventory.observation?.sequence ?? 0);
      expect(z.object({
        event: agentSessionEventSchema, connectionId: z.uuid(), historical: z.boolean(),
      }).parse(relay.calls.find((call) => call.path === "sessionEvent")?.input))
        .toMatchObject({ connectionId: relay.connectionId, historical: true });
      relay.emit({ type: "session.updated", session: { ...summary, status: "failed" } });
      await vi.waitFor(() => expect(relay.calls.filter((call) => call.path === "sessionUpdated")).toHaveLength(2));
      const live = updateSchema.parse(relay.calls.filter((call) => call.path === "sessionUpdated").at(-1)?.input);
      expect(live.observation.sequence).toBeGreaterThan(duringInventory.observation.sequence);
      expect(live.session.status).toBe("failed");
    } finally {
      await relay.close();
    }
  });
  it("reports initial sync failure, maintains the lease and accepts an explicit read-only retry", async () => {
    const relay = await fixture({ failFirst: true });
    try {
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "syncFailed")).toBe(true));
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "heartbeat")).toBe(true));
      expect(relay.logs.some((message) => message.includes("Catalog temporarily unavailable"))).toBe(true);
      const commandId = crypto.randomUUID();
      relay.sendListCommand(commandId);
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "syncSessions")).toBe(true));
      expect(sessionSyncSchema.parse(relay.calls.find((call) => call.path === "syncSessions")?.input))
        .toMatchObject({ commandId, observation: { connectionId: relay.connectionId } });
    } finally {
      await relay.close();
    }
  });
  it("retains successful execution when result upload fails and never retries the business operation", async () => {
    const relay = await fixture({ failCompletions: 1 });
    try {
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "syncSessions")).toBe(true));
      const commandId = crypto.randomUUID();
      relay.sendMessageCommand(commandId);
      await vi.waitFor(() => expect(relay.logs.some((message) => message.includes("retained the observed outcome"))).toBe(true));
      relay.sendListCommand(crypto.randomUUID());
      await vi.waitFor(() => expect(relay.calls.filter((call) => call.path === "commandCompleted")).toHaveLength(2));
      expect(relay.messages).toEqual(["Execute only once"]);
      const completions = relay.calls.filter((call) => call.path === "commandCompleted");
      for (const call of completions) {
        expect(call.input).toMatchObject({
          commandId, outcome: "succeeded", commandConnectionId: relay.connectionId,
        });
      }
    } finally { await relay.close(); }
  });
  it("reports an observed result after reconnect with the original command connection without re-executing", async () => {
    const relay = await fixture({ deferMessage: true });
    try {
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "syncSessions")).toBe(true));
      const originalConnection = relay.connectionId;
      const commandId = crypto.randomUUID();
      relay.sendMessageCommand(commandId);
      await vi.waitFor(() => expect(relay.messages).toHaveLength(1));
      relay.disconnect();
      await vi.waitFor(() => expect(relay.calls.filter((call) => call.path === "register")).toHaveLength(2));
      await vi.waitFor(() => expect(relay.calls.filter((call) => call.path === "syncSessions")).toHaveLength(2));
      expect(relay.connectionId).not.toBe(originalConnection);
      relay.finishMessage();
      await vi.waitFor(() => expect(relay.calls.some((call) => call.path === "commandCompleted")).toBe(true));
      expect(relay.calls.find((call) => call.path === "commandCompleted")?.input).toMatchObject({
        commandId, outcome: "succeeded", commandConnectionId: originalConnection,
      });
      expect(relay.messages).toEqual(["Execute only once"]);
    } finally { await relay.close(); }
  });
});
