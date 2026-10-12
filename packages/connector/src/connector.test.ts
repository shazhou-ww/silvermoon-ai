import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
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

interface RelayCall {
  path: string;
  input: unknown;
  connectionId: string;
}

async function fixture(options: { failFirst?: boolean; failCompletions?: number; deferMessage?: boolean; heartbeatMs?: number } = {}) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a local TCP listener.");
  let connectionId = "";
  const calls: RelayCall[] = [];
  const requests = new EventEmitter<{ call: [RelayCall] }>();
  const logs: string[] = [];
  let socket: WebSocket | undefined;
  let subscriptionId: string | number | undefined;
  let completionFailures = options.failCompletions ?? 0;
  server.on("connection", (connection) => {
    const issuedConnectionId = crypto.randomUUID();
    connectionId = issuedConnectionId;
    socket = connection;
    subscriptionId = undefined;
    connection.on("message", (data) => {
      if (String(data) === "PING") { connection.send("PONG"); return; }
      const decoded: unknown = JSON.parse(String(data));
      for (const raw of Array.isArray(decoded) ? decoded : [decoded]) {
        const frame = frameSchema.parse(raw);
        if (frame.method === "subscription.stop") continue;
        if (!frame.params) throw new Error("RPC request parameters are missing.");
        const call = { path: frame.params.path, input: frame.params.input, connectionId: issuedConnectionId };
        calls.push(call);
        requests.emit("call", call);
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
    token: "fictional-test-token", adapter, heartbeatMs: options.heartbeatMs ?? 20,
    log: (message) => logs.push(message),
  });
  connector.start();
  return {
    calls, logs, messages,
    get connectionId() { return connectionId; },
    waitForCall(path: string, matchesConnection: (id: string) => boolean = () => true): Promise<RelayCall> {
      const matches = (call: RelayCall) => call.path === path && matchesConnection(call.connectionId);
      const existing = calls.find(matches);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          requests.off("call", onCall);
          reject(new Error(`Timed out waiting for ${path} on the expected connection.`));
        }, 5_000);
        function onCall(call: RelayCall) {
          if (!matches(call)) return;
          clearTimeout(timeout);
          requests.off("call", onCall);
          resolve(call);
        }
        requests.on("call", onCall);
      });
    },
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
    const relay = await fixture({ deferMessage: true, heartbeatMs: 20_000 });
    try {
      const inventory = await relay.waitForCall("syncSessions");
      const originalConnection = inventory.connectionId;
      await relay.waitForCall("commands", (id) => id === originalConnection);
      const commandId = crypto.randomUUID();
      relay.sendMessageCommand(commandId);
      await vi.waitFor(() => expect(relay.messages).toHaveLength(1));
      const reconnected = relay.waitForCall("syncSessions", (id) => id !== originalConnection);
      relay.disconnect();
      const currentInventory = await reconnected;
      expect(sessionSyncSchema.parse(currentInventory.input).observation?.connectionId)
        .toBe(currentInventory.connectionId);
      expect(currentInventory.connectionId).not.toBe(originalConnection);
      const completed = relay.waitForCall("commandCompleted", (id) => id === currentInventory.connectionId);
      relay.finishMessage();
      expect((await completed).input).toMatchObject({
        commandId, outcome: "succeeded", commandConnectionId: originalConnection,
      });
      expect(relay.messages).toEqual(["Execute only once"]);
    } finally { await relay.close(); }
  });
});
