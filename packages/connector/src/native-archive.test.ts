import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { ActionType, SessionStatus, type SessionSummary } from "@microsoft/agent-host-protocol";
import { describe, expect, it, vi } from "vitest";
import { NativeStateUnconfirmedError } from "./adapter.js";
import { VsCodeAgentHostProvider, type AgentHostEndpointMetadata } from "./vscode-agent-host-provider.js";

async function fixture(version = "0.10.0", mode: "confirm" | "reject" | "mismatch" = "confirm") {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port.");
  const root = await mkdtemp(join(tmpdir(), "silvermoon-native-archive-"));
  const summary: SessionSummary = {
    resource: "copilotcli:/native-parent", provider: "copilotcli", title: "Native parent",
    status: SessionStatus.Idle, createdAt: "2026-10-12T00:00:00Z", modifiedAt: "2026-10-12T00:00:00Z",
    defaultChat: "ahp-chat:/native-parent/default",
    chats: [
      { resource: "ahp-chat:/native-parent/default", title: "Default", status: SessionStatus.Idle },
      { resource: "ahp-chat:/native-parent/child", title: "Native child", status: SessionStatus.Idle },
    ],
  };
  const dispatches: Array<{ channel: string; type: string; archived: boolean }> = [];
  const frameSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(), method: z.string(),
    params: z.object({ channel: z.string(), clientId: z.string().optional(), clientSeq: z.number().optional(),
      action: z.object({ type: z.string(), isArchived: z.boolean() }).optional() }),
  });
  server.on("connection", socket => {
    let clientId = "";
    let sequence = 0;
    socket.on("message", data => {
      const frame = frameSchema.parse(JSON.parse(String(data)));
      const params = frame.params;
      if (frame.method === "dispatchAction" && params.action) {
        const action = params.action;
        dispatches.push({ channel: params.channel, type: action.type, archived: action.isArchived });
        if (mode === "confirm") {
          if (params.channel === summary.resource) {
            summary.status = SessionStatus.Idle | (action.isArchived ? SessionStatus.IsArchived : 0);
          } else {
            const chat = summary.chats?.find(item => item.resource === params.channel);
            if (!chat) throw new Error("Unexpected native action target.");
            chat.status = SessionStatus.Idle | (action.isArchived ? SessionStatus.IsArchived : 0);
          }
        }
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "action", params: {
          channel: params.channel, serverSeq: ++sequence, action: mode === "mismatch"
            ? { ...action, isArchived: !action.isArchived } : action,
          origin: { clientId, clientSeq: params.clientSeq },
          ...(mode === "reject" ? { rejectionReason: "Fixture rejected archive." } : {}),
        } }));
        return;
      }
      if (frame.id === undefined) return;
      let result: unknown;
      if (frame.method === "initialize") {
        clientId = params.clientId ?? "";
        result = { protocolVersion: version, serverSeq: 0, snapshots: [] };
      } else if (frame.method === "listSessions") {
        result = { items: [summary] };
      } else if (frame.method === "subscribe") {
        const chat = summary.chats?.find(item => item.resource === params.channel);
        result = { snapshot: { channel: params.channel, serverSeq: sequence, state: chat
          ? { ...chat, turns: [], pendingMessages: [], inputRequests: [] }
          : { ...summary, activeClients: [] } } };
      } else if (frame.method === "ping") result = {};
      else throw new Error(`Unexpected native fixture request: ${frame.method}`);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
    });
  });
  const entry: AgentHostEndpointMetadata = {
    schemaVersion: 2, type: "editor", pid: process.pid, instanceId: "native-fixture",
    protocolVersion: version, connectionToken: "fictional-token",
    endpoint: { type: "tcp", host: "127.0.0.1", port: address.port },
  };
  const entries = join(root, "agent-host", "local-endpoint", "entries");
  await mkdir(entries, { recursive: true });
  const name = createHash("sha256").update(`${entry.type}\0${entry.pid}\0${entry.instanceId}`).digest("hex");
  await writeFile(join(entries, `${name}.json`), JSON.stringify(entry));
  const provider = new VsCodeAgentHostProvider({ userDataDirectory: root, refreshIntervalMs: 0 });
  return {
    provider, dispatches,
    changeLocally(archived: boolean) {
      summary.status = SessionStatus.Idle | (archived ? SessionStatus.IsArchived : 0);
      for (const socket of server.clients) socket.send(JSON.stringify({
        jsonrpc: "2.0", method: "root/sessionSummaryChanged",
        params: { channel: "ahp-root://", session: summary.resource, changes: { status: summary.status } },
      }));
    },
    async close() {
      await provider.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(root, { recursive: true });
    },
  };
}

describe("native Done / Restore Agent Host wire integration", () => {
  it("observes local Done / Restore without dispatching commands", async () => {
    const test = await fixture();
    try {
      await test.provider.listSessions();
      const events: boolean[] = [];
      const unsubscribe = test.provider.subscribe(event => {
        if (event.type === "session.updated" && event.session.id === "native-parent") {
          if (event.session.nativeArchived !== undefined) events.push(event.session.nativeArchived);
        }
      });
      test.changeLocally(true);
      await vi.waitFor(() => expect(events.at(-1)).toBe(true));
      test.changeLocally(false);
      await vi.waitFor(() => expect(events.at(-1)).toBe(false));
      unsubscribe();
      expect(test.dispatches).toHaveLength(0);
    } finally { await test.close(); }
  });
  it("dispatches parent/default chat to the Session and independent child to its own chat", async () => {
    const test = await fixture();
    try {
      const sessions = await test.provider.listSessions();
      const parent = sessions.find(item => !item.parentSessionId)!;
      const child = sessions.find(item => item.parentSessionId)!;
      expect(parent).toMatchObject({ nativeArchived: false, canSetNativeArchive: true });
      expect(await test.provider.setSessionArchived({ sessionId: parent.id, archived: true }))
        .toMatchObject({ nativeArchived: true, canSendMessage: false });
      expect(await test.provider.setSessionArchived({ sessionId: parent.id, archived: false }))
        .toMatchObject({ nativeArchived: false });
      expect(await test.provider.setSessionArchived({ sessionId: child.id, archived: true }))
        .toMatchObject({ nativeArchived: true });
      expect(await test.provider.setSessionArchived({ sessionId: child.id, archived: false }))
        .toMatchObject({ nativeArchived: false });
      expect(test.dispatches).toEqual([
        { channel: "copilotcli:/native-parent", type: ActionType.SessionIsArchivedChanged, archived: true },
        { channel: "copilotcli:/native-parent", type: ActionType.SessionIsArchivedChanged, archived: false },
        { channel: "ahp-chat:/native-parent/child", type: ActionType.ChatIsArchivedChanged, archived: true },
        { channel: "ahp-chat:/native-parent/child", type: ActionType.ChatIsArchivedChanged, archived: false },
      ]);
    } finally { await test.close(); }
  });

  it.each(["reject", "mismatch"] as const)("does not claim success for %s acknowledgements or replay", async mode => {
    const test = await fixture(undefined, mode);
    try {
      const parent = (await test.provider.listSessions()).find(item => !item.parentSessionId)!;
      const operation = test.provider.setSessionArchived({ sessionId: parent.id, archived: true });
      if (mode === "mismatch") await expect(operation).rejects.toBeInstanceOf(NativeStateUnconfirmedError);
      else await expect(operation).rejects.toThrow("Fixture rejected archive");
      expect((await test.provider.listSessions()).find(item => item.id === parent.id)?.nativeArchived).toBe(false);
      expect(test.dispatches).toHaveLength(1);
    } finally { await test.close(); }
  });

  it("does not claim native capability for an incompatible old Agent Host", async () => {
    const test = await fixture("0.8.0");
    try {
      await expect(test.provider.listSessions()).rejects.toThrow(
        "No compatible VS Code Agent Host is available.",
      );
      await expect(test.provider.setSessionArchived({ sessionId: "native-parent", archived: true })).rejects.toThrow();
      expect(test.dispatches).toHaveLength(0);
    } finally { await test.close(); }
  });
});
