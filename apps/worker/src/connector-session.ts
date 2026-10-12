import { DurableObject } from "cloudflare:workers";
import {
  connectorCommandSchema,
  connectorIdSchema,
  type AgentSession,
  type AgentSessionEvent,
  type ConnectorCommand,
  type ConnectorId,
  PROTOCOL_VERSION,
} from "@silvermoon-ai/protocol";
import {
  connectorRouter,
  type ConnectorRpcContext,
  type SessionObservation,
} from "@silvermoon-ai/rpc";
import { TRPCError } from "@trpc/server";
import { acceptTRPCWebSocket } from "./trpc-websocket";

interface ConnectionAttachment {
  connectionId: string;
  connectorId: ConnectorId;
  tokenId: string;
  userId: string;
  socket: WebSocket;
  leaseExpiresAt: number;
  confirmationEnabled: boolean;
  registered: boolean;
}

interface CommandWaiter {
  connectionId: string;
  resolve(command: ConnectorCommand | null): void;
}

type RegistrationInput = Parameters<ConnectorRpcContext["register"]>[0];
type CommandCompletion = Parameters<
  ConnectorRpcContext["commandCompleted"]
>[0];

function eventPreview(event: AgentSessionEvent): string | null {
  if (!event.text) return null;
  return event.text.length <= 512
    ? event.text
    : `${event.text.slice(0, 509)}...`;
}

export const CONNECTION_LEASE_MS = 60_000;

export function connectionLeaseIsActive(
  leaseExpiresAt: number,
  now = Date.now(),
): boolean {
  return leaseExpiresAt > now;
}

export class ConnectorSession extends DurableObject<Env> {
  private readonly connections = new Set<ConnectionAttachment>();
  private readonly commandWaiters = new Set<CommandWaiter>();

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get("x-silvermoon-user-id");
    const tokenId = request.headers.get("x-silvermoon-token-id");
    const connectorIdResult = connectorIdSchema.safeParse(
      request.headers.get("x-silvermoon-connector-id"),
    );
    if (
      request.headers.get("upgrade")?.toLowerCase() !== "websocket"
      || !userId
      || !tokenId
      || !connectorIdResult.success
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const now = Date.now();
    for (const connection of this.connections) {
      if (connectionLeaseIsActive(connection.leaseExpiresAt, now)) {
        return Response.json(
          { error: "token-already-connected" },
          { status: 409 },
        );
      }
      this.cancelCommandWaiters(connection.connectionId);
      this.connections.delete(connection);
      connection.socket.close(4008, "connection lease expired");
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      connectorId: connectorIdResult.data,
      tokenId,
      userId,
      socket: server,
      leaseExpiresAt: now + CONNECTION_LEASE_MS,
      confirmationEnabled: false,
      registered: false,
    };
    this.connections.add(attachment);
    const bound = await this.env.DB.prepare(
      `UPDATE connectors SET connection_id = ?1, session_sync_state = 'pending',
        session_sync_error = NULL
       WHERE user_id = ?2 AND id = ?3 AND connection_token_id = ?4
         AND EXISTS (SELECT 1 FROM devices WHERE user_id = ?2 AND id = ?3 AND removed_at IS NULL)
         AND EXISTS (SELECT 1 FROM connection_tokens WHERE id = ?4 AND revoked_at IS NULL
           AND (expires_at IS NULL OR julianday(expires_at) > julianday('now')))`,
    ).bind(attachment.connectionId, userId, attachment.connectorId, tokenId).run();
    if (bound.meta.changes !== 1) {
      this.connections.delete(attachment);
      return Response.json({ error: "device-connection-replaced" }, { status: 409 });
    }
    server.addEventListener("close", () => {
      void this.connectionClosed(attachment);
    });

    acceptTRPCWebSocket(request, server, {
      router: connectorRouter,
      createContext: () => this.createRpcContext(attachment),
      onError: ({ error, path }) => {
        console.error(JSON.stringify({
          event: "connector.rpc.error",
          connectorId: attachment.connectorId,
          path,
          code: error.code,
          message: error.message,
        }));
      },
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async dispatchCommand(
    value: ConnectorCommand,
  ): Promise<{ delivered: boolean }> {
    const command = connectorCommandSchema.parse(value);
    const waiter = [...this.commandWaiters].at(-1);
    if (!waiter) return { delivered: false };
    const connection = [...this.connections].find(
      (item) => item.connectionId === waiter.connectionId,
    );
    if (
      !connection
      || !connection.registered
      || !connectionLeaseIsActive(connection.leaseExpiresAt)
      || (command.connectionId && command.connectionId !== connection.connectionId)
    ) return { delivered: false };
    this.commandWaiters.delete(waiter);
    const sent = await this.env.DB.prepare(
      `UPDATE connector_commands SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP, connection_id = ?2
       WHERE id = ?1 AND status = 'queued'
         AND user_id = ?3 AND connector_id = ?4
         AND EXISTS (SELECT 1 FROM connectors
           WHERE user_id = ?3 AND id = ?4 AND connection_id = ?2 AND status = 'online'
             AND (?5 <> 'session.create' OR json_extract(capabilities_json, '$.createSession') = 1)
             AND (?5 <> 'session.message' OR json_extract(capabilities_json, '$.sendMessage') = 1))
         AND (?5 <> 'session.archive' OR EXISTS (
           SELECT 1 FROM agent_sessions WHERE user_id = ?3 AND connector_id = ?4 AND id = ?6
             AND confirmed_connection_id = ?2 AND can_set_native_archive = 1 AND native_archived IS NOT NULL)
           AND EXISTS (SELECT 1 FROM connectors WHERE user_id = ?3 AND id = ?4
             AND json_extract(capabilities_json, '$.setNativeArchive') = 1))
         AND (?5 <> 'session.message' OR EXISTS (
           SELECT 1 FROM agent_sessions WHERE user_id = ?3 AND connector_id = ?4 AND id = ?6
             AND confirmed_connection_id = ?2 AND capability_confirmed = 1 AND can_send_message = 1
             AND COALESCE(native_archived, work_state = 'completed') = 0))`,
    ).bind(
      command.commandId, connection.connectionId, connection.userId, connection.connectorId,
      command.type, command.type === "session.message" || command.type === "session.archive" ? command.sessionId : null,
    ).run();
    if (sent.meta.changes !== 1) {
      if (this.connections.has(connection)) this.commandWaiters.add(waiter);
      else waiter.resolve(null);
      return { delivered: false };
    }
    waiter.resolve(command);
    return { delivered: true };
  }

  async revokeToken(tokenId: string): Promise<number> {
    let closed = 0;
    for (const connection of this.connections) {
      if (connection.tokenId !== tokenId) continue;
      this.cancelCommandWaiters(connection.connectionId);
      this.connections.delete(connection);
      connection.socket.close(4003, "connection token revoked");
      closed += 1;
    }
    return closed;
  }

  private createRpcContext(
    attachment: ConnectionAttachment,
  ): ConnectorRpcContext {
    return {
      connectorId: attachment.connectorId,
      register: (input) => this.register(attachment, input),
      heartbeat: () => this.touchConnector(attachment),
      syncSessions: async (sessions, commandId, observation) => {
        await this.validateObservation(attachment, observation);
        await Promise.all(
          sessions.map((session) => this.upsertSession(attachment, session, observation, true)),
        );
        if (observation) {
          await this.env.DB.prepare(
            `UPDATE connectors SET session_sync_state = 'ready', session_sync_error = NULL
             WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3`,
          ).bind(attachment.userId, attachment.connectorId, attachment.connectionId).run();
        }
        if (commandId) {
          await this.completeCommand(
            attachment,
            commandId,
            "succeeded",
          );
        }
      },
      syncFailed: async (connectionId, message) => {
        await this.ensureCurrentConnection(attachment);
        if (connectionId !== attachment.connectionId) {
          throw new TRPCError({ code: "CONFLICT", message: "Obsolete Session sync connection." });
        }
        await this.env.DB.prepare(
          `UPDATE connectors SET session_sync_state = 'failed', session_sync_error = ?1
           WHERE user_id = ?2 AND id = ?3 AND connection_id = ?4`,
        ).bind(message, attachment.userId, attachment.connectorId, connectionId).run();
      },
      commandAccepted: (commandId) =>
        this.commandAccepted(attachment, commandId),
      commandCompleted: async (input) => {
        const pending = await this.env.DB.prepare(
          `SELECT type, session_id, payload_json, connection_id, status FROM connector_commands
           WHERE id = ?1 AND user_id = ?2 AND connector_id = ?3`,
        ).bind(input.commandId, attachment.userId, attachment.connectorId)
          .first<{ type: string; session_id: string | null; payload_json: string; connection_id: string | null; status: string }>();
        if (pending?.type === "session.archive" && input.outcome === "failed" && input.session) {
          throw new TRPCError({ code: "CONFLICT", message: "An unconfirmed native result cannot update Session state." });
        }
        if (pending?.type === "session.archive" && input.outcome === "succeeded") {
          const command = connectorCommandSchema.parse(JSON.parse(pending.payload_json));
          if (command.type !== "session.archive" || pending.connection_id !== attachment.connectionId
            || !["sent", "accepted"].includes(pending.status)
            || input.commandConnectionId !== attachment.connectionId
            || input.observation?.connectionId !== attachment.connectionId
            || input.session?.id !== command.sessionId
            || input.session.nativeArchived !== command.archived
            || input.session.canSetNativeArchive !== true) {
            throw new TRPCError({ code: "CONFLICT", message: "Native archive result does not match the current command." });
          }
        }
        if (input.session) {
          await this.upsertSession(attachment, input.session, input.observation);
        }
        await this.completeCommand(
          attachment,
          input.commandId,
          input.outcome,
          input.error,
          input.commandConnectionId,
        );
      },
      sessionUpdated: (session, observation) =>
        this.upsertSession(attachment, session, observation),
      sessionEvent: async (event, connectionId, historical) => {
        await this.validateEventConnection(attachment, connectionId);
        await this.storeEvent(attachment, event, historical);
      },
      sessionEvents: async (events, connectionId) => {
        await this.validateEventConnection(attachment, connectionId);
        await this.storeEvents(attachment, events);
      },
      commands: (signal) => this.commandStream(attachment, signal),
    };
  }

  private async register(
    attachment: ConnectionAttachment,
    input: RegistrationInput,
  ): ReturnType<ConnectorRpcContext["register"]> {
    attachment.confirmationEnabled = input.confirmationVersion === 1;
    await this.ensureCurrentConnection(attachment);
    const registered = await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE connector_commands SET status = 'failed',
          error_code = 'command-not-delivered',
          error_message = 'The command was not delivered before the connector reconnected.',
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND connector_id = ?2
           AND status = 'queued'
           AND EXISTS (SELECT 1 FROM connectors WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3)`,
      ).bind(attachment.userId, attachment.connectorId, attachment.connectionId),
      this.env.DB.prepare(
        `UPDATE connector_commands SET result_uncertain_at = CURRENT_TIMESTAMP,
          error_code = 'command-result-unconfirmed',
          error_message = 'The connector reconnected; the command result is not yet confirmed.',
          updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND connector_id = ?2 AND status IN ('sent', 'accepted')
           AND EXISTS (SELECT 1 FROM connectors WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3)`,
      ).bind(attachment.userId, attachment.connectorId, attachment.connectionId),
      this.env.DB.prepare(
        `UPDATE connectors SET agent_name = ?1,
          agent_version = ?2, capabilities_json = ?3, status = 'online',
          connected_at = CURRENT_TIMESTAMP, disconnected_at = NULL,
          last_seen_at = CURRENT_TIMESTAMP, connection_id = ?6,
          session_sync_state = ?7, session_sync_error = NULL
         WHERE user_id = ?4 AND id = ?5 AND connection_id = ?6`,
      ).bind(
        input.agent.name,
        input.agent.version ?? null,
        JSON.stringify(input.capabilities),
        attachment.userId,
        attachment.connectorId,
        attachment.connectionId,
        attachment.confirmationEnabled ? "pending" : "unsupported",
      ),
    ]);
    if (registered[2].meta.changes !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "Registration belongs to an obsolete connection." });
    }
    attachment.registered = true;
    return {
      protocolVersion: PROTOCOL_VERSION,
      connectionId: attachment.connectionId,
      connectorId: attachment.connectorId,
    };
  }

  private async ensureCurrentConnection(attachment: ConnectionAttachment): Promise<void> {
    const current = await this.env.DB.prepare(
      `SELECT c.connection_id FROM connectors c
       JOIN devices d ON d.user_id = c.user_id AND d.id = c.id
       JOIN connection_tokens t ON t.id = ?3 AND t.user_id = c.user_id AND t.device_id = c.id
       WHERE c.user_id = ?1 AND c.id = ?2 AND d.removed_at IS NULL AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR julianday(t.expires_at) > julianday('now'))`,
    ).bind(attachment.userId, attachment.connectorId, attachment.tokenId).first<string>("connection_id");
    if (
      current !== attachment.connectionId
      || !this.connections.has(attachment)
      || !connectionLeaseIsActive(attachment.leaseExpiresAt)
    ) {
      throw new TRPCError({ code: "CONFLICT", message: "Obsolete Relay connection." });
    }
  }

  private async validateObservation(
    attachment: ConnectionAttachment,
    observation?: SessionObservation,
  ): Promise<void> {
    await this.ensureCurrentConnection(attachment);
    if (
      (attachment.confirmationEnabled && !observation)
      || (observation && observation.connectionId !== attachment.connectionId)
    ) {
      throw new TRPCError({ code: "CONFLICT", message: "Session confirmation belongs to another connection." });
    }
  }

  private async validateEventConnection(
    attachment: ConnectionAttachment,
    connectionId?: string,
  ): Promise<void> {
    await this.ensureCurrentConnection(attachment);
    if (
      (attachment.confirmationEnabled && !connectionId)
      || (connectionId && connectionId !== attachment.connectionId)
    ) {
      throw new TRPCError({ code: "CONFLICT", message: "Event belongs to an obsolete connection." });
    }
  }

  private async touchConnector(
    attachment: ConnectionAttachment,
  ): Promise<void> {
    attachment.leaseExpiresAt = Date.now() + CONNECTION_LEASE_MS;
    if (!attachment.registered) return;
    await this.ensureCurrentConnection(attachment);
    await this.env.DB.prepare(
      `UPDATE connectors SET last_seen_at = CURRENT_TIMESTAMP, status = 'online'
       WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3`,
    )
      .bind(attachment.userId, attachment.connectorId, attachment.connectionId)
      .run();
  }

  private async commandAccepted(
    attachment: ConnectionAttachment,
    commandId: string,
  ): Promise<void> {
    await this.ensureCurrentConnection(attachment);
    await this.env.DB.prepare(
      `UPDATE connector_commands SET status = 'accepted',
        accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2 AND connector_id = ?3
         AND status IN ('queued', 'sent')
         AND (connection_id IS NULL OR connection_id = ?4)
         AND EXISTS (SELECT 1 FROM connectors
           WHERE user_id = ?2 AND id = ?3 AND connection_id = ?4)`,
    )
      .bind(commandId, attachment.userId, attachment.connectorId, attachment.connectionId)
      .run();
  }

  private async *commandStream(
    attachment: ConnectionAttachment,
    signal: AbortSignal,
  ): AsyncGenerator<ConnectorCommand> {
    while (!signal.aborted) {
      const command = await new Promise<ConnectorCommand | null>((resolve) => {
        const waiter: CommandWaiter = {
          connectionId: attachment.connectionId,
          resolve: (value) => {
          this.commandWaiters.delete(waiter);
          signal.removeEventListener("abort", aborted);
          resolve(value);
          },
        };
        const aborted = () => waiter.resolve(null);
        this.commandWaiters.add(waiter);
        signal.addEventListener("abort", aborted, { once: true });
      });
      if (!command) return;
      yield command;
    }
  }

  private async upsertSession(
    attachment: ConnectionAttachment,
    session: AgentSession,
    observation?: SessionObservation,
    allowSuperseded = false,
  ): Promise<void> {
    await this.validateObservation(attachment, observation);
    const result = await this.env.DB.prepare(
      `INSERT INTO agent_sessions
        (user_id, connector_id, id, title, status, native_status, created_at, updated_at,
         last_activity_at, last_message_preview, parent_session_id,
         can_send_message, confirmed_connection_id, observation_sequence,
         execution_state_known, capability_confirmed, can_set_native_archive, native_archived)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?17, ?18
       WHERE EXISTS (SELECT 1 FROM connectors WHERE user_id = ?1 AND id = ?2 AND connection_id = ?16)
       ON CONFLICT (user_id, connector_id, id) DO UPDATE SET
         title = excluded.title,
         status = excluded.status,
         native_status = excluded.native_status,
         updated_at = excluded.updated_at,
         last_activity_at = CASE
           WHEN julianday(excluded.last_activity_at) > julianday(agent_sessions.last_activity_at)
           THEN excluded.last_activity_at ELSE agent_sessions.last_activity_at END,
         parent_session_id = excluded.parent_session_id,
         can_send_message = excluded.can_send_message,
         confirmed_connection_id = excluded.confirmed_connection_id,
         observation_sequence = excluded.observation_sequence,
         execution_state_known = excluded.execution_state_known,
         capability_confirmed = excluded.capability_confirmed,
         can_set_native_archive = excluded.can_set_native_archive,
         native_archived = COALESCE(excluded.native_archived, agent_sessions.native_archived),
         last_message_preview = CASE
           WHEN julianday(excluded.last_activity_at) >= julianday(agent_sessions.last_activity_at)
           THEN COALESCE(excluded.last_message_preview, agent_sessions.last_message_preview)
           ELSE agent_sessions.last_message_preview END
       WHERE agent_sessions.confirmed_connection_id IS NOT excluded.confirmed_connection_id
          OR agent_sessions.observation_sequence <= excluded.observation_sequence`,
    )
      .bind(
        attachment.userId,
        attachment.connectorId,
        session.id,
        session.title,
        session.status,
        session.nativeStatus ?? null,
        session.createdAt,
        session.updatedAt,
        session.lastMessagePreview,
        session.parentSessionId ?? null,
        session.canSendMessage === false ? 0 : 1,
        observation?.connectionId ?? null,
        observation?.sequence ?? 0,
        observation && session.executionStateKnown === true ? 1 : 0,
        observation && session.canSendMessage !== undefined ? 1 : 0,
        attachment.connectionId,
        observation && session.canSetNativeArchive === true ? 1 : 0,
        observation && session.nativeArchived !== undefined ? (session.nativeArchived ? 1 : 0) : null,
      )
      .run();
    if (result.meta.changes === 0) {
      if (allowSuperseded && observation) {
        const newer = await this.env.DB.prepare(
          `SELECT 1 FROM agent_sessions AS s JOIN connectors AS c
             ON c.user_id = s.user_id AND c.id = s.connector_id
           WHERE s.user_id = ?1 AND s.connector_id = ?2 AND s.id = ?3
             AND c.connection_id = ?4 AND s.confirmed_connection_id = ?4
             AND s.observation_sequence > ?5`,
        ).bind(attachment.userId, attachment.connectorId, session.id, observation.connectionId, observation.sequence)
          .first();
        if (newer) return;
      }
      throw new TRPCError({ code: "CONFLICT", message: "A newer Session observation is already stored." });
    }
  }

  private async storeEvent(
    attachment: ConnectionAttachment,
    event: AgentSessionEvent,
    historical = false,
  ): Promise<void> {
    const observedStatus = attachment.confirmationEnabled || historical ? null : event.status ?? null;
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO agent_sessions
          (user_id, connector_id, id, title, status, native_status, created_at, updated_at,
           last_activity_at, last_message_preview)
         SELECT ?1, ?2, ?3, NULL, ?4, NULL, ?5, ?5, ?5, ?6
         WHERE EXISTS (SELECT 1 FROM connectors WHERE user_id = ?1 AND id = ?2 AND connection_id = ?8)
         ON CONFLICT (user_id, connector_id, id) DO UPDATE SET
           status = COALESCE(?7, agent_sessions.status),
           updated_at = CASE WHEN julianday(?5) > julianday(agent_sessions.updated_at) THEN ?5 ELSE agent_sessions.updated_at END,
           last_activity_at = CASE WHEN julianday(?5) > julianday(agent_sessions.last_activity_at) THEN ?5 ELSE agent_sessions.last_activity_at END,
           last_message_preview = CASE
             WHEN julianday(?5) >= julianday(agent_sessions.last_activity_at)
             THEN COALESCE(?6, agent_sessions.last_message_preview)
             ELSE agent_sessions.last_message_preview END`,
      ).bind(
        attachment.userId,
        attachment.connectorId,
        event.sessionId,
        observedStatus ?? "unknown",
        event.createdAt,
        eventPreview(event),
        observedStatus,
        attachment.connectionId,
      ),
      this.eventInsert(attachment, event),
    ]);
  }

  private async storeEvents(
    attachment: ConnectionAttachment,
    events: AgentSessionEvent[],
  ): Promise<void> {
    await this.env.DB.batch(
      events.map((event) => this.eventInsert(attachment, event)),
    );
  }

  private eventInsert(
    attachment: ConnectionAttachment,
    event: AgentSessionEvent,
  ) {
    // Historical projections can retain a sequence while deriving a newer ID.
    return this.env.DB.prepare(
      `INSERT INTO agent_session_events
        (user_id, connector_id, session_id, event_id, sequence, type, role,
         content, data_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT
       DO UPDATE SET
         type = excluded.type,
         role = COALESCE(excluded.role, agent_session_events.role),
         content = COALESCE(excluded.content, agent_session_events.content),
         data_json = CASE
           WHEN agent_session_events.data_json IS NULL THEN excluded.data_json
           WHEN excluded.data_json IS NULL THEN agent_session_events.data_json
           ELSE json_patch(agent_session_events.data_json, excluded.data_json)
         END`,
    ).bind(
      attachment.userId,
      attachment.connectorId,
      event.sessionId,
      event.id,
      event.sequence,
      event.type,
      event.role ?? null,
      event.text ?? null,
      event.data ? JSON.stringify(event.data) : null,
      event.createdAt,
    );
  }

  private async completeCommand(
    attachment: ConnectionAttachment,
    commandId: string,
    outcome: "succeeded" | "failed",
    error?: CommandCompletion["error"],
    commandConnectionId = attachment.connectionId,
  ): Promise<void> {
    await this.ensureCurrentConnection(attachment);
    const command = await this.env.DB.prepare(
      `SELECT connection_id FROM connector_commands
       WHERE id = ?1 AND user_id = ?2 AND connector_id = ?3`,
    ).bind(commandId, attachment.userId, attachment.connectorId)
      .first<{ connection_id: string | null }>();
    if (!command || !command.connection_id || command.connection_id !== commandConnectionId) {
      throw new TRPCError({ code: "CONFLICT", message: "Command result belongs to another connection." });
    }
    if (error?.code === "native-state-unconfirmed") {
      await this.env.DB.prepare(
        `UPDATE connector_commands SET result_uncertain_at = CURRENT_TIMESTAMP,
           error_code = ?1, error_message = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3 AND user_id = ?4 AND connector_id = ?5 AND type = 'session.archive'
           AND connection_id = ?6 AND status IN ('sent', 'accepted')`,
      ).bind(error.code, error.message ?? null, commandId, attachment.userId, attachment.connectorId, commandConnectionId).run();
      return;
    }
    const completion = this.env.DB.prepare(
      `UPDATE connector_commands SET status = ?1, error_code = ?2,
        error_message = ?3, completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP, result_uncertain_at = NULL
       WHERE id = ?4 AND user_id = ?5 AND connector_id = ?6
         AND status IN ('queued', 'sent', 'accepted')
         AND (connection_id IS NULL OR connection_id = ?7)
         AND EXISTS (SELECT 1 FROM connectors
           WHERE user_id = ?5 AND id = ?6 AND connection_id = ?8)`,
    )
      .bind(
        outcome,
        error?.code ?? null,
        error?.message ?? null,
        commandId,
        attachment.userId,
        attachment.connectorId,
        commandConnectionId,
        attachment.connectionId,
      );
    if (outcome === "failed") {
      await completion.run();
      return;
    }
    await this.env.DB.batch([
      completion,
      this.env.DB.prepare(
        `UPDATE agent_sessions SET history_synced_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND connector_id = ?2
           AND id = (
             SELECT session_id FROM connector_commands
             WHERE id = ?3 AND user_id = ?1 AND connector_id = ?2
               AND type = 'session.history' AND status = 'succeeded'
           )`,
      ).bind(
        attachment.userId,
        attachment.connectorId,
        commandId,
      ),
    ]);
  }

  private async connectionClosed(
    attachment: ConnectionAttachment,
  ): Promise<void> {
    this.cancelCommandWaiters(attachment.connectionId);
    this.connections.delete(attachment);
    if (
      [...this.connections].some(
        (connection) =>
          connection.connectorId === attachment.connectorId
          && connection.userId === attachment.userId,
      )
    ) {
      return;
    }
    await this.env.DB.prepare(
      `UPDATE connectors SET status = 'offline',
        disconnected_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3`,
    )
      .bind(attachment.userId, attachment.connectorId, attachment.connectionId)
      .run();
  }

  private cancelCommandWaiters(connectionId: string): void {
    for (const waiter of this.commandWaiters) {
      if (waiter.connectionId === connectionId) waiter.resolve(null);
    }
  }
}
