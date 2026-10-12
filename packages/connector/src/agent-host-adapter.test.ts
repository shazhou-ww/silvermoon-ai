import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionType,
  SessionLifecycle,
  SessionStatus,
  type SessionSummary,
} from "@microsoft/agent-host-protocol";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  type AgentHostEndpointMetadata,
  VsCodeAgentHostProvider,
} from "./vscode-agent-host-provider.js";

const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
});

async function fixture(hostCount = 1) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolveListening) =>
    server.once("listening", resolveListening)
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing Agent Host fixture port.");
  }
  const root = await mkdtemp(join(tmpdir(), "silvermoon-agent-host-adapter-"));
  const summaries: SessionSummary[] = [];
  const requests: Array<{
    method: string;
    channel?: string;
    provider?: string;
    workingDirectories?: string[];
    actionType?: string;
  }> = [];

  server.on("connection", (socket) => {
    let clientId = "";
    let sequence = 0;
    socket.on("message", (data) => {
      const frame = requestSchema.parse(JSON.parse(String(data)));
      const channel = typeof frame.params.channel === "string"
        ? frame.params.channel
        : undefined;
      const action = z.object({ type: z.string() }).passthrough().safeParse(
        frame.params.action,
      );
      requests.push({
        method: frame.method,
        channel,
        provider: typeof frame.params.provider === "string"
          ? frame.params.provider
          : undefined,
        workingDirectories: z.array(z.string()).safeParse(
          frame.params.workingDirectories,
        ).data,
        actionType: action.success ? action.data.type : undefined,
      });

      if (frame.method === "dispatchAction" && channel && action.success) {
        const summary = summaries[0];
        if (
          summary
          && action.data.type === ActionType.SessionTitleChanged
          && typeof action.data.title === "string"
        ) {
          summary.title = action.data.title;
        }
        socket.send(JSON.stringify({
          jsonrpc: "2.0",
          method: "action",
          params: {
            channel,
            serverSeq: ++sequence,
            action: action.data,
            origin: {
              clientId,
              clientSeq: frame.params.clientSeq,
            },
          },
        }));
        if (action.data.type === ActionType.ChatTurnStarted && summary) {
          socket.send(JSON.stringify({
            jsonrpc: "2.0",
            method: "root/sessionAdded",
            params: {
              channel: "ahp-root://",
              summary,
            },
          }));
          socket.send(JSON.stringify({
            jsonrpc: "2.0",
            method: "action",
            params: {
              channel: summary.resource,
              serverSeq: ++sequence,
              action: { type: ActionType.SessionReady },
            },
          }));
        }
        return;
      }
      if (frame.id === undefined) return;

      let result: unknown;
      if (frame.method === "initialize") {
        clientId = typeof frame.params.clientId === "string"
          ? frame.params.clientId
          : "";
        result = {
          protocolVersion: "1.0.0",
          serverSeq: sequence,
          snapshots: [],
        };
      } else if (frame.method === "listSessions") {
        result = { items: summaries };
      } else if (frame.method === "createSession") {
        if (!channel) throw new Error("Fixture createSession requires channel.");
        summaries.push({
          resource: channel,
          provider: String(frame.params.provider),
          title: "New session",
          status: SessionStatus.Idle,
          createdAt: "2026-10-12T12:00:00.000Z",
          modifiedAt: "2026-10-12T12:00:00.000Z",
          defaultChat: "ahp-chat:/created/default",
          chats: [{
            resource: "ahp-chat:/created/default",
            title: "Default",
            status: SessionStatus.Idle,
          }],
        });
        result = null;
      } else if (frame.method === "subscribe") {
        const summary = summaries[0];
        if (!summary || !channel) {
          throw new Error("Fixture subscribe requires a created session.");
        }
        result = {
          snapshot: {
            channel,
            serverSeq: sequence,
            state: channel === summary.resource
              ? {
                  ...summary,
                  lifecycle: SessionLifecycle.Creating,
                  activeClients: [],
                }
              : {
                  resource: channel,
                  title: "Default",
                  status: SessionStatus.Idle,
                  modifiedAt: summary.modifiedAt,
                  turns: [],
                  pendingMessages: [],
                  inputRequests: [],
                },
          },
        };
      } else if (frame.method === "ping") {
        result = {};
      } else {
        throw new Error(`Unexpected Agent Host request: ${frame.method}`);
      }
      socket.send(JSON.stringify({
        jsonrpc: "2.0",
        id: frame.id,
        result,
      }));
    });
  });

  const entries = join(root, "agent-host", "local-endpoint", "entries");
  await mkdir(entries, { recursive: true });
  for (let index = 0; index < hostCount; index += 1) {
    const entry: AgentHostEndpointMetadata = {
      schemaVersion: 2,
      type: "editor",
      pid: process.pid,
      instanceId: `adapter-fixture-${index}`,
      protocolVersion: "1.0.0",
      connectionToken: "fixture-token",
      endpoint: {
        type: "tcp",
        host: "127.0.0.1",
        port: address.port,
      },
    };
    const name = createHash("sha256")
      .update(`${entry.type}\0${entry.pid}\0${entry.instanceId}`)
      .digest("hex");
    await writeFile(join(entries, `${name}.json`), JSON.stringify(entry));
  }

  const provider = new VsCodeAgentHostProvider({
    userDataDirectory: root,
    workingDirectory: root,
    refreshIntervalMs: 0,
  });
  return {
    provider,
    requests,
    async close() {
      await provider.close();
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => error ? rejectClose(error) : resolveClose())
      );
      await rm(root, { recursive: true });
    },
  };
}

describe("AHP-only Agent adapter", () => {
  it("creates and starts a Session entirely through one Agent Host", async () => {
    const test = await fixture();
    try {
      const created = await test.provider.createSession({
        title: "Explicit title",
        prompt: "Implement the AHP-only connector",
      });

      expect(created).toMatchObject({
        id: expect.any(String),
        title: "Explicit title",
        executionStateKnown: true,
      });
      const create = test.requests.find((request) =>
        request.method === "createSession"
      );
      expect(create).toMatchObject({
        provider: "copilotcli",
        channel: expect.stringMatching(/^ahp-session:\/[0-9a-f-]+$/u),
        workingDirectories: [expect.stringMatching(/^file:/u)],
      });
      expect(test.requests).toContainEqual(expect.objectContaining({
        method: "dispatchAction",
        channel: create?.channel,
        actionType: ActionType.SessionTitleChanged,
      }));
      expect(test.requests).toContainEqual(expect.objectContaining({
        method: "dispatchAction",
        channel: "ahp-chat:/created/default",
        actionType: ActionType.ChatTurnStarted,
      }));
    } finally {
      await test.close();
    }
  });

  it("reports unavailable instead of succeeding with an empty SDK fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "silvermoon-no-agent-host-"));
    const provider = new VsCodeAgentHostProvider({
      userDataDirectory: directory,
      refreshIntervalMs: 0,
    });
    try {
      await expect(provider.listSessions()).rejects.toThrow(
        "No compatible VS Code Agent Host is available.",
      );
      await expect(provider.createSession({ prompt: "Do not fallback" }))
        .rejects.toThrow("No compatible VS Code Agent Host is available.");
    } finally {
      await provider.close();
      await rm(directory, { recursive: true });
    }
  });

  it("rejects ambiguous creation when multiple Agent Hosts are available", async () => {
    const test = await fixture(2);
    try {
      await expect(test.provider.listSessions()).resolves.toEqual([]);
      await expect(test.provider.createSession({ prompt: "Choose safely" }))
        .rejects.toThrow(
          "Session creation requires exactly one compatible VS Code Agent Host.",
        );
      expect(test.requests.some((request) =>
        request.method === "createSession"
      )).toBe(false);
    } finally {
      await test.close();
    }
  });
});
