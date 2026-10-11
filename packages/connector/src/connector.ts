import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { ConnectorCommand } from "@silvermoon-ai/protocol";
import type {
  ConnectorRouter,
  SessionObservation,
  commandCompletedInputSchema,
} from "@silvermoon-ai/rpc";
import type { z } from "zod";
import { TRPCClientError } from "@trpc/client";
import WebSocket from "ws";
import type { AgentAdapter, AgentAdapterEvent } from "./adapter.js";

export interface SilvermoonConnectorOptions {
  relayUrl: string;
  token: string;
  adapter: AgentAdapter;
  heartbeatMs?: number;
  eventBufferLimit?: number;
  log?: (message: string) => void;
}

type ConnectorClient = ReturnType<typeof createTRPCClient<ConnectorRouter>>;
type ConnectorWsClient = ReturnType<typeof createWSClient>;
const HISTORY_EVENT_BATCH_SIZE = 50;

function connectorSocketUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("Relay URL must use http, https, ws, or wss.");
  }
  url.pathname = "/v1/connect";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function authenticatedWebSocket(
  token: string,
): typeof globalThis.WebSocket {
  class AuthenticatedWebSocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols ?? [], {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }
  }
  return AuthenticatedWebSocket as unknown as typeof globalThis.WebSocket;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SilvermoonConnector {
  private readonly heartbeatMs: number;
  private readonly eventBufferLimit: number;
  private readonly log: (message: string) => void;
  private client: ConnectorClient | null = null;
  private wsClient: ConnectorWsClient | null = null;
  private commandSubscription: { unsubscribe(): void } | null = null;
  private adapterUnsubscribe: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private running = false;
  private connectionGeneration = 0;
  private connectionId: string | null = null;
  private observationSequence = 0;
  private commandQueue = Promise.resolve();
  private registration = Promise.resolve();
  private readonly pendingEvents: Array<{
    event: AgentAdapterEvent;
    observation?: SessionObservation;
  }> = [];
  private readonly pendingResults = new Map<
    string, z.infer<typeof commandCompletedInputSchema>
  >();

  constructor(private readonly options: SilvermoonConnectorOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.eventBufferLimit = options.eventBufferLimit ?? 1_000;
    this.log = options.log ?? ((message) => console.log(message));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.adapterUnsubscribe = this.options.adapter.subscribe((event) => {
      void this.publishEvent(event);
    });

    this.wsClient = createWSClient({
      url: connectorSocketUrl(this.options.relayUrl),
      WebSocket: authenticatedWebSocket(this.options.token),
      keepAlive: {
        enabled: true,
        intervalMs: 20_000,
        pongTimeoutMs: 5_000,
      },
      onOpen: () => {
        this.registration = this.onOpen();
      },
      onClose: () => {
        this.connectionGeneration += 1;
        this.connected = false;
        this.connectionId = null;
        this.log("Relay connection closed; tRPC will reconnect.");
      },
      onError: () => {
        this.log("Relay WebSocket reported a connection error.");
      },
    });
    this.client = createTRPCClient<ConnectorRouter>({
      links: [wsLink({ client: this.wsClient })],
    });
    this.commandSubscription = this.client.commands.subscribe(undefined, {
      onData: (command) => {
        const generation = this.connectionGeneration;
        const registration = this.registration;
        this.commandQueue = this.commandQueue
          .then(async () => {
            await registration;
            if (generation === this.connectionGeneration) {
              await this.executeCommand(command, generation);
            }
          })
          .catch((error: unknown) => {
            this.log(`Command queue failed: ${errorMessage(error)}`);
          });
      },
      onError: (error) => {
        this.log(`Command subscription failed: ${error.message}`);
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.connectionGeneration += 1;
    this.connected = false;
    this.connectionId = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.commandSubscription?.unsubscribe();
    this.commandSubscription = null;
    this.adapterUnsubscribe?.();
    this.adapterUnsubscribe = null;
    this.wsClient?.close();
    this.wsClient = null;
    this.client = null;
    await this.options.adapter.close?.();
  }

  private async onOpen(): Promise<void> {
    const client = this.client;
    if (!client || !this.running) return;
    const generation = this.connectionGeneration;
    try {
      const welcome = await client.register.mutate({
        agent: this.options.adapter.agent,
        capabilities: this.options.adapter.capabilities,
        confirmationVersion: 1,
      });
      if (generation !== this.connectionGeneration) return;
      this.connectionId = welcome.connectionId;
      this.observationSequence = 0;
      if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), this.heartbeatMs);
      }
      const observation = this.nextObservation();
      const sessions = await this.options.adapter.listSessions();
      if (generation !== this.connectionGeneration) return;
      await client.syncSessions.mutate({ sessions, observation });
      if (generation !== this.connectionGeneration) return;
      this.connected = true;
      this.log(
        `Relay accepted ${welcome.connectorId} as ${welcome.connectionId}.`,
      );
      await this.flushPendingEvents();
      await this.flushPendingResults();
    } catch (error) {
      if (generation !== this.connectionGeneration) return;
      this.connected = false;
      this.log(`Connector registration failed: ${errorMessage(error)}`);
      if (this.connectionId) {
        try {
          await client.syncFailed.mutate({
            connectionId: this.connectionId,
            message: errorMessage(error).slice(0, 2_048),
          });
        } catch (reportError) {
          this.log(`Could not report Session sync failure: ${errorMessage(reportError)}`);
        }
      }
    }
  }

  private nextObservation(): SessionObservation {
    if (!this.connectionId) throw new Error("Relay connection is not registered.");
    return {
      connectionId: this.connectionId,
      sequence: ++this.observationSequence,
    };
  }

  private async executeCommand(
    command: ConnectorCommand,
    generation: number,
  ): Promise<void> {
    const client = this.client;
    if (!client || generation !== this.connectionGeneration) return;
    if (command.connectionId && command.connectionId !== this.connectionId) {
      this.log("Discarded a command addressed to an obsolete Relay connection.");
      return;
    }
    const commandConnectionId = command.connectionId ?? this.connectionId ?? undefined;
    await client.commandAccepted.mutate({ commandId: command.commandId });
    if (generation !== this.connectionGeneration) return;
    try {
      if (command.type === "sessions.list") {
        const observation = this.nextObservation();
        const sessions = await this.options.adapter.listSessions();
        if (generation !== this.connectionGeneration) return;
        await client.syncSessions.mutate({
          commandId: command.commandId,
          sessions,
          observation,
        });
        if (generation !== this.connectionGeneration) return;
        this.connected = true;
        await this.flushPendingEvents();
        await this.flushPendingResults();
        return;
      }
      if (command.type === "session.history") {
        const events = await this.options.adapter.loadSessionHistory(
          command.sessionId,
        );
        if (generation !== this.connectionGeneration) return;
        for (
          let index = 0;
          index < events.length;
          index += HISTORY_EVENT_BATCH_SIZE
        ) {
          await client.sessionEvents.mutate({
            events: events.slice(index, index + HISTORY_EVENT_BATCH_SIZE),
            connectionId: this.connectionId ?? undefined,
          });
          if (generation !== this.connectionGeneration) return;
        }
        await client.commandCompleted.mutate({
          commandId: command.commandId,
          outcome: "succeeded",
        });
        return;
      }
      if (command.type === "session.create") {
        const session = await this.options.adapter.createSession({
          prompt: command.prompt,
          ...(command.title === undefined ? {} : { title: command.title }),
        });
        if (generation === this.connectionGeneration) {
          await this.publishEvent({ type: "session.updated", session });
        }
      } else {
        await this.options.adapter.sendMessage({
          sessionId: command.sessionId,
          message: command.message,
        });
      }
      this.pendingResults.set(command.commandId, {
        commandId: command.commandId,
        outcome: "succeeded",
        commandConnectionId,
      });
      await this.flushPendingResults();
    } catch (error) {
      if (command.type === "session.message" || command.type === "session.create") {
        this.pendingResults.set(command.commandId, {
          commandId: command.commandId,
          commandConnectionId,
          outcome: "failed",
          error: { code: "copilot-command-failed", message: errorMessage(error).slice(0, 2_048) },
        });
        await this.flushPendingResults();
        return;
      }
      if (generation !== this.connectionGeneration) return;
      if (command.type === "sessions.list" && this.connectionId) {
        await client.syncFailed.mutate({
          connectionId: this.connectionId,
          message: errorMessage(error).slice(0, 2_048),
        });
      }
      await client.commandCompleted.mutate({
        commandId: command.commandId,
        outcome: "failed",
        error: {
          code: "copilot-command-failed",
          message: errorMessage(error).slice(0, 2_048),
        },
      });
    }
  }

  private async publishEvent(event: AgentAdapterEvent): Promise<void> {
    const observation = event.type === "session.updated" && this.connectionId
      ? this.nextObservation() : undefined;
    if (!this.connected || !this.client) {
      this.bufferEvent(event, observation);
      return;
    }
    try {
      if (event.type === "session.updated") {
        await this.client.sessionUpdated.mutate({
          session: event.session,
          observation: observation ?? this.nextObservation(),
        });
      } else {
        if (!this.connectionId) throw new Error("Relay connection is not registered.");
        await this.client.sessionEvent.mutate({
          event: event.event,
          connectionId: this.connectionId,
        });
      }
    } catch (error) {
      if (!(error instanceof TRPCClientError && error.data?.code === "CONFLICT")) {
        this.bufferEvent(event, observation);
      }
      this.log(`Session event upload failed: ${errorMessage(error)}`);
    }
  }

  private bufferEvent(event: AgentAdapterEvent, observation?: SessionObservation): void {
    if (this.pendingEvents.length >= this.eventBufferLimit) {
      this.pendingEvents.shift();
      this.log("Event buffer full; dropped the oldest transient observation.");
    }
    this.pendingEvents.push({ event, observation });
  }

  private async flushPendingEvents(): Promise<void> {
    while (this.connected && this.pendingEvents.length) {
      const pending = this.pendingEvents.shift();
      if (!pending) continue;
      const { event, observation } = pending;
      if (event.type === "session.updated") {
        if (!observation || observation.connectionId !== this.connectionId) {
          this.log("Discarded a buffered Session snapshot superseded by the current inventory.");
          continue;
        }
      }
      const connectionId = this.connectionId;
      const client = this.client;
      if (!connectionId || !client) throw new Error("Relay connection is not registered.");
      try {
        if (event.type === "session.updated") {
          await client.sessionUpdated.mutate({
            session: event.session,
            observation: observation ?? this.nextObservation(),
          });
        } else {
          await client.sessionEvent.mutate({
            event: event.event,
            connectionId,
            historical: true,
          });
        }
      } catch (error) {
        this.log(`Buffered observation upload failed: ${errorMessage(error)}`);
        if (error instanceof TRPCClientError && error.data?.code === "CONFLICT") continue;
        this.pendingEvents.unshift(pending);
        break;
      }
    }
  }

  private async flushPendingResults(): Promise<void> {
    const client = this.client;
    const connectionId = this.connectionId;
    if (!client || !connectionId) return;
    for (const [id, result] of this.pendingResults) {
      try {
        await client.commandCompleted.mutate(result);
        this.pendingResults.delete(id);
      } catch (error) {
        this.log(`Command result upload failed; retained the observed outcome: ${errorMessage(error)}`);
        break;
      }
      if (this.connectionId !== connectionId) break;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.connectionId || !this.client) return;
    const connectionId = this.connectionId;
    try {
      await this.client.heartbeat.mutate({
        observedAt: new Date().toISOString(),
      });
      if (this.connectionId === connectionId) {
        if (this.connected) await this.flushPendingEvents();
        await this.flushPendingResults();
      }
    } catch (error) {
      if (this.connectionId !== connectionId) return;
      this.connected = false;
      this.log(`Heartbeat failed: ${errorMessage(error)}`);
    }
  }
}
