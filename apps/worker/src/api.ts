import type { AppEnv } from "./env";
import { removeDevice, renameDevice } from "./devices";
import {
  agentInputRequestSchema,
  connectorCapabilitiesSchema,
  connectorIdSchema,
  createSessionCommandSchema,
  listSessionsCommandSchema,
  PROTOCOL_VERSION,
  sendSessionMessageCommandSchema,
  setSessionArchiveCommandSchema,
  sessionIdSchema,
  sessionWorkStateSchema,
  syncSessionHistoryCommandSchema,
  type AgentInputRequest,
  type ConnectorCommand,
  type SessionWorkState,
} from "@silvermoon-ai/protocol";
import {
  clearSessionCookies,
  readSession,
  verifyCsrf,
} from "./session";
import {
  createToken,
  listTokens,
  revokeToken,
  rotateToken,
} from "./tokens";
import {
  isAllowedOrigin,
  json,
  withCors,
} from "./http";

interface UserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface IdentityRow {
  provider: string;
  email: string | null;
  email_verified: number;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string;
}

interface ConnectorRow {
  id: string;
  display_name: string;
  agent_name: string | null;
  agent_version: string | null;
  capabilities_json: string;
  status: "online" | "offline";
  connected_at: string | null;
  disconnected_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  session_count: number;
  connection_id: string | null;
  session_sync_state: "unsupported" | "pending" | "ready" | "failed";
  session_sync_error: string | null;
  removed_at: string | null;
  disconnect_requested_at: string | null;
}

interface InputRequestEventRow {
  session_id: string;
  role: string | null;
  content: string | null;
  data_json: string;
}

export function pendingInputRequests(
  rows: readonly InputRequestEventRow[],
): Map<string, AgentInputRequest> {
  const pending = new Map<string, AgentInputRequest>();
  const seen = new Set<string>();
  for (const row of rows) {
    let data: unknown;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    const eventData = data as Record<string, unknown>;
    const requestId = typeof eventData.inputRequestId === "string"
      ? eventData.inputRequestId
      : null;
    if (!requestId) continue;
    const requestKey = `${row.session_id}\0${requestId}`;
    if (seen.has(requestKey)) continue;
    seen.add(requestKey);
    const resolved = typeof eventData.inputRequestResolved === "boolean"
      ? eventData.inputRequestResolved
      : row.role === "user";
    if (resolved || pending.has(row.session_id)) continue;
    const structured = agentInputRequestSchema.safeParse(
      eventData.inputRequest,
    );
    pending.set(
      row.session_id,
      structured.success
        ? structured.data
        : {
            id: requestId,
            message: row.content?.trim() || null,
            url: null,
            questions: [],
          },
    );
  }
  return pending;
}

type ConnectorState = Pick<ConnectorRow,
  "id" | "status" | "connection_id" | "session_sync_state" | "capabilities_json" | "removed_at"
>;

function response(
  request: Request,
  env: AppEnv,
  value: unknown,
  init: ResponseInit = {},
): Response {
  const result = withCors(json(value, init), request, env);
  result.headers.set("cache-control", "no-store");
  return result;
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new Error("json-required");
  }
  const body = await request.json<unknown>();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid-json");
  }
  return body as Record<string, unknown>;
}

async function notifyTokenRevocation(
  env: AppEnv,
  userId: string,
  tokenId: string,
): Promise<void> {
  const token = await env.DB.prepare(
    `SELECT device_id FROM connection_tokens
     WHERE user_id = ?1 AND id = ?2`,
  )
    .bind(userId, tokenId)
    .first<{ device_id: string }>();
  if (!token) return;
  await env.DAEMON_SESSIONS.getByName(tokenId).revokeToken(tokenId);
}

function pathValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function connectorForUser(
  env: AppEnv,
  userId: string,
  connectorId: string,
): Promise<ConnectorState | null> {
  return env.DB.prepare(
    `SELECT c.id, c.status, c.connection_id, c.session_sync_state, c.capabilities_json, d.removed_at
     FROM connectors c JOIN devices d ON d.user_id = c.user_id AND d.id = c.id
     WHERE c.user_id = ?1 AND c.id = ?2`,
  )
    .bind(userId, connectorId)
    .first<ConnectorState>();
}

async function dispatchCommand(
  env: AppEnv,
  userId: string,
  connectorId: string,
  command: ConnectorCommand,
): Promise<boolean> {
  const connector = await connectorForUser(env, userId, connectorId);
  const addressedCommand = {
    ...command,
    ...(command.connectionId || connector?.connection_id
      ? { connectionId: command.connectionId ?? connector?.connection_id ?? undefined }
      : {}),
  };
  const queued = await env.DB.prepare(
    `INSERT INTO connector_commands
      (id, user_id, connector_id, type, session_id, payload_json, status, connection_id)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7
     WHERE EXISTS (SELECT 1 FROM devices
       WHERE user_id = ?2 AND id = ?3 AND removed_at IS NULL)
       AND (?4 <> 'session.archive' OR EXISTS (
         SELECT 1 FROM agent_sessions s JOIN connectors c ON c.user_id = s.user_id AND c.id = s.connector_id
         WHERE s.user_id = ?2 AND s.connector_id = ?3 AND s.id = ?5
           AND s.confirmed_connection_id = ?7 AND s.can_set_native_archive = 1 AND s.native_archived IS NOT NULL
           AND c.connection_id = ?7 AND c.status = 'online'
           AND json_extract(c.capabilities_json, '$.setNativeArchive') = 1))
       AND (?4 <> 'session.message' OR EXISTS (
         SELECT 1 FROM agent_sessions WHERE user_id = ?2 AND connector_id = ?3
           AND id = ?5 AND COALESCE(native_archived, work_state = 'completed') = 0))`,
  )
    .bind(
      command.commandId,
      userId,
      connectorId,
      command.type,
      command.type === "session.message" || command.type === "session.history" || command.type === "session.archive"
        ? command.sessionId
        : null,
      JSON.stringify(addressedCommand),
      addressedCommand.connectionId ?? null,
    )
    .run();
  if (queued.meta.changes !== 1) return false;

  const result = await env.DAEMON_SESSIONS
    .getByName(
      await env.DB.prepare(
        `SELECT connection_token_id FROM connectors
         WHERE user_id = ?1 AND id = ?2`,
      ).bind(userId, connectorId).first<string>("connection_token_id")
        ?? `${userId}:${connectorId}`,
    )
    .dispatchCommand(addressedCommand);
  if (result.delivered) return true;

  const workCompleted = command.type === "session.message"
    && await env.DB.prepare(
      `SELECT 1 FROM agent_sessions
       WHERE user_id = ?1 AND connector_id = ?2 AND id = ?3
         AND COALESCE(native_archived, work_state = 'completed') = 1`,
    ).bind(userId, connectorId, command.sessionId).first() !== null;
  await env.DB.prepare(
    `UPDATE connector_commands SET status = 'failed',
      error_code = ?2,
      error_message = ?3,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND status = 'queued'`,
  )
    .bind(
      command.commandId,
      workCompleted ? "session-completed-reactivate-first" : "connector-offline",
      workCompleted ? "Reactivate the Session before sending a follow-up." : "The connector is not currently connected.",
    )
    .run();
  return false;
}

export async function handleApi(
  request: Request,
  env: AppEnv,
  context: ExecutionContext,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request, env)) {
      return response(request, env, { error: "origin-not-allowed" }, { status: 403 });
    }
    const preflight = new Response(null, { status: 204 });
    preflight.headers.set("access-control-allow-origin", env.WEB_ORIGIN);
    preflight.headers.set("access-control-allow-credentials", "true");
    preflight.headers.set(
      "access-control-allow-headers",
      "content-type,x-csrf-token",
    );
    preflight.headers.set(
      "access-control-allow-methods",
      "GET,POST,DELETE,OPTIONS",
    );
    preflight.headers.set("access-control-max-age", "600");
    return preflight;
  }
  if (!isAllowedOrigin(request, env)) {
    return response(request, env, { error: "origin-not-allowed" }, { status: 403 });
  }

  const session = await readSession(request, env);
  if (!session) {
    return response(request, env, { error: "authentication-required" }, { status: 401 });
  }
  context.waitUntil(
    env.DB.prepare(
      "UPDATE browser_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
    )
      .bind(session.id)
      .run(),
  );
  if (
    request.method !== "GET"
    && !(await verifyCsrf(request, session, env))
  ) {
    return response(request, env, { error: "csrf-invalid" }, { status: 403 });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const deviceMatch = /^\/api\/devices\/([^/]+)(\/rename)?$/u.exec(path);
  if (deviceMatch && (request.method === "DELETE" || request.method === "POST")) {
    const id = connectorIdSchema.safeParse(pathValue(deviceMatch[1]));
    if (!id.success) return response(request, env, { error: "invalid-device-id" }, { status: 400 });
    if (request.method === "POST" && deviceMatch[2]) {
      try {
        const renamed = await renameDevice(env, session.userId, id.data, (await requestBody(request)).name);
        return response(request, env, { renamed }, { status: renamed ? 200 : 404 });
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error
          && ["invalid-device-name", "json-required", "invalid-json"].includes(error.message))) {
          return response(request, env, { error: error instanceof SyntaxError ? "invalid-json" : error.message }, { status: 400 });
        }
        throw error;
      }
    }
    if (request.method === "DELETE" && !deviceMatch[2]) {
      const result = await removeDevice(env, session.userId, id.data);
      return response(request, env, result ?? { error: "device-not-found" },
        { status: !result ? 404 : result.disconnectRequested ? 200 : 202 });
    }
  }
  const writeConnector = /^\/api\/connectors\/([^/]+)\//u.exec(path);
  if (request.method !== "GET" && writeConnector) {
    const id = connectorIdSchema.safeParse(pathValue(writeConnector[1]));
    if (id.success && (await connectorForUser(env, session.userId, id.data))?.removed_at) {
      return response(request, env, { error: "device-removed" }, { status: 409 });
    }
  }
  if (request.method === "GET" && path === "/api/me") {
    const [user, identities] = await Promise.all([
      env.DB.prepare(
        "SELECT id, display_name, avatar_url, created_at FROM users WHERE id = ?1",
      ).bind(session.userId).first<UserRow>(),
      env.DB.prepare(
        `SELECT provider, email, email_verified, display_name, avatar_url,
          created_at, last_login_at
         FROM external_identities WHERE user_id = ?1 ORDER BY created_at`,
      ).bind(session.userId).all<IdentityRow>(),
    ]);
    if (!user) return response(request, env, { error: "user-not-found" }, { status: 404 });
    return response(request, env, {
      user: {
        id: user.id,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
      },
      identities: identities.results.map((identity) => ({
        provider: identity.provider,
        email: identity.email,
        emailVerified: identity.email_verified === 1,
        displayName: identity.display_name,
        avatarUrl: identity.avatar_url,
        createdAt: identity.created_at,
        lastLoginAt: identity.last_login_at,
      })),
      sessionId: session.id,
    });
  }

  if (request.method === "POST" && path === "/api/logout") {
    await env.DB.prepare(
      `UPDATE browser_sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(session.id, session.userId)
      .run();
    return clearSessionCookies(response(request, env, { ok: true }), env);
  }

  if (request.method === "GET" && path === "/api/sessions") {
    const sessions = await env.DB.prepare(
      `SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent
       FROM browser_sessions WHERE user_id = ?1 ORDER BY created_at DESC`,
    )
      .bind(session.userId)
      .all<{
        id: string;
        created_at: string;
        last_seen_at: string;
        expires_at: string;
        revoked_at: string | null;
        user_agent: string | null;
      }>();
    return response(request, env, sessions.results.map((item) => ({
      id: item.id,
      current: item.id === session.id,
      createdAt: item.created_at,
      lastSeenAt: item.last_seen_at,
      expiresAt: item.expires_at,
      revokedAt: item.revoked_at,
      userAgent: item.user_agent,
    })));
  }

  if (request.method === "GET" && path === "/api/connectors") {
    const connectors = await env.DB.prepare(
      `SELECT c.id, c.display_name, c.agent_name, c.agent_version,
        c.capabilities_json, c.status, c.connected_at, c.disconnected_at,
        c.last_seen_at, c.created_at, c.connection_id, c.session_sync_state,
        c.session_sync_error, d.removed_at, d.disconnect_requested_at, COUNT(s.id) AS session_count
       FROM connectors c
       JOIN devices d ON d.user_id = c.user_id AND d.id = c.id
       LEFT JOIN agent_sessions s
         ON s.user_id = c.user_id AND s.connector_id = c.id
       WHERE c.user_id = ?1
       GROUP BY c.user_id, c.id
       ORDER BY c.status DESC, c.last_seen_at DESC, c.display_name`,
    )
      .bind(session.userId)
      .all<ConnectorRow>();
    return response(request, env, connectors.results.map((connector) => ({
      id: connector.id,
      displayName: connector.display_name,
      agent: connector.agent_name
        ? {
            name: connector.agent_name,
            version: connector.agent_version,
          }
        : null,
      capabilities: connectorCapabilitiesSchema.parse(
        JSON.parse(connector.capabilities_json),
      ),
      status: connector.status,
      connectedAt: connector.connected_at,
      disconnectedAt: connector.disconnected_at,
      lastSeenAt: connector.last_seen_at,
      createdAt: connector.created_at,
      sessionCount: connector.session_count,
      connectionId: connector.connection_id,
      sessionSyncState: connector.session_sync_state,
      sessionSyncError: connector.session_sync_error,
      removedAt: connector.removed_at,
      disconnectRequestedAt: connector.disconnect_requested_at,
    })));
  }

  const connectorSessionsMatch =
    /^\/api\/connectors\/([^/]+)\/sessions$/u.exec(path);
  if (connectorSessionsMatch) {
    const connectorId = pathValue(connectorSessionsMatch[1]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    if (!parsedConnectorId.success) {
      return response(
        request,
        env,
        { error: "invalid-connector-id" },
        { status: 400 },
      );
    }
    const connector = await connectorForUser(
      env,
      session.userId,
      parsedConnectorId.data,
    );
    if (!connector) {
      return response(
        request,
        env,
        { error: "connector-not-found" },
        { status: 404 },
      );
    }

    if (request.method === "GET") {
      const paged = url.searchParams.get("paged") === "1";
      const cursor = url.searchParams.get("cursor");
      if (cursor !== null && (!paged || !sessionIdSchema.safeParse(cursor).success)) {
        return response(request, env, { error: "invalid-session-cursor" }, { status: 400 });
      }
      const sessions = await env.DB.prepare(
        `SELECT id, title, status, native_status, created_at, updated_at, last_activity_at,
          last_message_preview, parent_session_id, can_send_message,
          confirmed_connection_id, execution_state_known, capability_confirmed, work_state,
          can_set_native_archive, native_archived
         FROM agent_sessions
         WHERE user_id = ?1 AND connector_id = ?2
           AND (?3 IS NULL OR id > ?3)
         ORDER BY ${paged ? "id" : "last_activity_at DESC"}
         LIMIT ?4`,
      )
        .bind(session.userId, connector.id, paged ? cursor : null, paged ? 501 : 500)
        .all<{
          id: string;
          title: string | null;
          status: string;
          native_status: string | null;
          created_at: string;
          updated_at: string;
          last_activity_at: string;
          last_message_preview: string | null;
          parent_session_id: string | null;
          can_send_message: number;
          confirmed_connection_id: string | null;
          execution_state_known: number;
          capability_confirmed: number;
          work_state: SessionWorkState;
          can_set_native_archive: number;
          native_archived: number | null;
        }>();
      const items = paged ? sessions.results.slice(0, 500) : sessions.results;
      const inputEvents = await env.DB.prepare(
        `SELECT session_id, role, content, data_json
         FROM agent_session_events
         WHERE user_id = ?1 AND connector_id = ?2
           AND data_json IS NOT NULL
           AND json_extract(data_json, '$.inputRequestId') IS NOT NULL
           AND (?3 IS NULL OR session_id > ?3)
           AND (?4 IS NULL OR session_id <= ?4)
         ORDER BY session_id, sequence DESC`,
      ).bind(
        session.userId, connector.id, paged ? cursor : null,
        paged ? items.at(-1)?.id ?? null : null,
      ).all<InputRequestEventRow>();
      const requests = pendingInputRequests(inputEvents.results);
      const serialized = items.map((item) => ({
        id: item.id,
        connectorId: connector.id,
        title: item.title,
        status: item.status,
        workState: item.native_archived === null ? item.work_state : item.native_archived ? "completed" : "open",
        legacyWorkState: item.work_state,
        canSetNativeArchive: item.can_set_native_archive === 1,
        nativeArchived: item.native_archived === null ? null : item.native_archived === 1,
        nativeStatus: item.native_status,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        lastActivityAt: item.last_activity_at,
        lastMessagePreview: item.last_message_preview,
        parentSessionId: item.parent_session_id,
        canSendMessage: item.can_send_message !== 0,
        pendingInputRequest: requests.get(item.id) ?? null,
        confirmedConnectionId: item.confirmed_connection_id,
        executionStateKnown: item.execution_state_known === 1,
        capabilityConfirmed: item.capability_confirmed === 1,
      }));
      return response(request, env, paged ? {
        sessions: serialized,
        nextCursor: sessions.results.length > 500 ? items.at(-1)?.id ?? null : null,
      } : serialized);
    }

    if (request.method === "POST") {
      const body = await requestBody(request);
      const command = createSessionCommandSchema.safeParse({
        type: "session.create",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        prompt: body.prompt,
        ...(body.title === undefined ? {} : { title: body.title }),
      });
      if (!command.success) {
        return response(
          request,
          env,
          { error: "invalid-session-request" },
          { status: 400 },
        );
      }
      const delivered = await dispatchCommand(
        env,
        session.userId,
        connector.id,
        command.data,
      );
      return response(
        request,
        env,
        {
          command: {
            id: command.data.commandId,
            type: command.data.type,
            status: delivered ? "sent" : "failed",
          },
          ...(delivered ? {} : { error: "connector-offline" }),
        },
        { status: delivered ? 202 : 409 },
      );
    }
  }

  const sessionSyncMatch = /^\/api\/connectors\/([^/]+)\/sessions\/sync$/u.exec(path);
  if (request.method === "POST" && sessionSyncMatch) {
    const parsed = connectorIdSchema.safeParse(pathValue(sessionSyncMatch[1]));
    if (!parsed.success) {
      return response(request, env, { error: "invalid-connector-id" }, { status: 400 });
    }
    const connector = await connectorForUser(env, session.userId, parsed.data);
    if (!connector) return response(request, env, { error: "connector-not-found" }, { status: 404 });
    if (
      connector.status !== "online"
      || !connector.connection_id
      || connector.session_sync_state === "unsupported"
      || !connectorCapabilitiesSchema.parse(JSON.parse(connector.capabilities_json)).listSessions
    ) {
      return response(request, env, { error: "session-sync-unavailable" }, { status: 409 });
    }
    const pending = await env.DB.prepare(
      `SELECT id, status FROM connector_commands
       WHERE user_id = ?1 AND connector_id = ?2 AND connection_id = ?3
         AND type = 'sessions.list' AND status IN ('queued', 'sent', 'accepted')
         AND result_uncertain_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    ).bind(session.userId, connector.id, connector.connection_id)
      .first<{ id: string; status: string }>();
    if (pending) {
      return response(request, env, {
        command: { id: pending.id, type: "sessions.list", status: pending.status },
      }, { status: 202 });
    }
    await env.DB.prepare(
      `UPDATE connectors SET session_sync_state = 'pending', session_sync_error = NULL
       WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3`,
    ).bind(session.userId, connector.id, connector.connection_id).run();
    const command = listSessionsCommandSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      type: "sessions.list",
      commandId: crypto.randomUUID(),
      connectionId: connector.connection_id,
    });
    const delivered = await dispatchCommand(env, session.userId, connector.id, command);
    if (!delivered) {
      await env.DB.prepare(
        `UPDATE connectors SET session_sync_state = 'failed',
          session_sync_error = 'The Device could not receive the sync request.'
         WHERE user_id = ?1 AND id = ?2 AND connection_id = ?3`,
      ).bind(session.userId, connector.id, connector.connection_id).run();
    }
    return response(request, env, {
      command: { id: command.commandId, type: command.type, status: delivered ? "sent" : "failed" },
      ...(delivered ? {} : { error: "session-sync-unavailable" }),
    }, { status: delivered ? 202 : 409 });
  }

  const sessionHistorySyncMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/events\/sync$/u.exec(path);
  if (request.method === "POST" && sessionHistorySyncMatch) {
    const connectorId = pathValue(sessionHistorySyncMatch[1]);
    const agentSessionId = pathValue(sessionHistorySyncMatch[2]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    const parsedSessionId = sessionIdSchema.safeParse(agentSessionId);
    if (!parsedConnectorId.success || !parsedSessionId.success) {
      return response(
        request,
        env,
        { error: "invalid-session-route" },
        { status: 400 },
      );
    }
    const owned = await env.DB.prepare(
      `SELECT CASE
         WHEN session.history_synced_at IS NULL THEN 0
         WHEN session.status != 'waiting' THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM agent_session_events AS event
           WHERE event.user_id = session.user_id
             AND event.connector_id = session.connector_id
             AND event.session_id = session.id
             AND json_type(event.data_json, '$.inputRequest') = 'object'
             AND COALESCE(
               json_extract(event.data_json, '$.inputRequestResolved'),
               0
             ) = 0
         ) THEN 1
         ELSE 0
       END AS history_current
       FROM agent_sessions AS session
       WHERE session.user_id = ?1
         AND session.connector_id = ?2
         AND session.id = ?3`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first<{ history_current: number }>();
    if (!owned) {
      return response(
        request,
        env,
        { error: "session-not-found" },
        { status: 404 },
      );
    }
    const inFlight = await env.DB.prepare(
      `SELECT id, status FROM connector_commands
       WHERE user_id = ?1 AND connector_id = ?2 AND session_id = ?3
         AND type = 'session.history'
         AND status IN ('queued', 'sent', 'accepted')
         AND result_uncertain_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first<{ id: string; status: "queued" | "sent" | "accepted" }>();
    if (inFlight) {
      return response(
        request,
        env,
        {
          command: {
            id: inFlight.id,
            type: "session.history",
            status: inFlight.status,
          },
        },
        { status: 202 },
      );
    }
    if (owned.history_current === 1) {
      return response(request, env, {
        command: null,
        synced: true,
      });
    }
    const command = syncSessionHistoryCommandSchema.parse({
      type: "session.history",
      protocolVersion: PROTOCOL_VERSION,
      commandId: crypto.randomUUID(),
      sessionId: parsedSessionId.data,
    });
    const delivered = await dispatchCommand(
      env,
      session.userId,
      parsedConnectorId.data,
      command,
    );
    return response(
      request,
      env,
      {
        command: {
          id: command.commandId,
          type: command.type,
          status: delivered ? "sent" : "failed",
        },
        ...(delivered ? {} : { error: "connector-offline" }),
      },
      { status: delivered ? 202 : 409 },
    );
  }

  const sessionEventsMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/events$/u.exec(path);
  if (request.method === "GET" && sessionEventsMatch) {
    const connectorId = pathValue(sessionEventsMatch[1]);
    const agentSessionId = pathValue(sessionEventsMatch[2]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    const parsedSessionId = sessionIdSchema.safeParse(agentSessionId);
    if (!parsedConnectorId.success || !parsedSessionId.success) {
      return response(
        request,
        env,
        { error: "invalid-session-route" },
        { status: 400 },
      );
    }
    const owned = await env.DB.prepare(
      `SELECT 1 FROM agent_sessions
       WHERE user_id = ?1 AND connector_id = ?2 AND id = ?3`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first();
    if (!owned) {
      return response(
        request,
        env,
        { error: "session-not-found" },
        { status: 404 },
      );
    }
    const after = Number(url.searchParams.get("after") ?? "-1");
    if (!Number.isSafeInteger(after) || after < -1) {
      return response(
        request,
        env,
        { error: "invalid-event-cursor" },
        { status: 400 },
      );
    }
    const events = await env.DB.prepare(
      `SELECT event_id, sequence, type, role, content, data_json, created_at
       FROM agent_session_events
       WHERE user_id = ?1 AND connector_id = ?2 AND session_id = ?3
         AND sequence > ?4
       ORDER BY sequence
       LIMIT 500`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
        after,
      )
      .all<{
        event_id: string;
        sequence: number;
        type: string;
        role: string | null;
        content: string | null;
        data_json: string | null;
        created_at: string;
      }>();
    return response(request, env, {
      events: events.results.map((event) => ({
        id: event.event_id,
        sessionId: parsedSessionId.data,
        sequence: event.sequence,
        type: event.type,
        role: event.role,
        text: event.content,
        data: event.data_json ? JSON.parse(event.data_json) : null,
        createdAt: event.created_at,
      })),
      nextAfter: events.results.at(-1)?.sequence ?? after,
    });
  }

  const sessionWorkStateMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/work-state$/u.exec(path);
  if (request.method === "POST" && sessionWorkStateMatch) {
    const connectorId = connectorIdSchema.safeParse(pathValue(sessionWorkStateMatch[1]));
    const agentSessionId = sessionIdSchema.safeParse(pathValue(sessionWorkStateMatch[2]));
    if (!connectorId.success || !agentSessionId.success) {
      return response(request, env, { error: "invalid-session-route" }, { status: 400 });
    }
    let body: Record<string, unknown>;
    try {
      body = await requestBody(request);
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error
        && ["json-required", "invalid-json"].includes(error.message))) {
        return response(request, env, { error: error instanceof SyntaxError ? "invalid-json" : error.message }, { status: 400 });
      }
      throw error;
    }
    const workState = sessionWorkStateSchema.safeParse(body.workState);
    if (!workState.success) {
      return response(request, env, { error: "invalid-session-work-state" }, { status: 400 });
    }
    const connector = await connectorForUser(env, session.userId, connectorId.data);
    if (connector?.removed_at) return response(request, env, { error: "device-removed" }, { status: 409 });
    const owned = await env.DB.prepare(
      `SELECT confirmed_connection_id, can_set_native_archive, native_archived FROM agent_sessions
       WHERE user_id = ?1 AND connector_id = ?2 AND id = ?3`,
    ).bind(session.userId, connectorId.data, agentSessionId.data)
      .first<{ confirmed_connection_id: string | null; can_set_native_archive: number; native_archived: number | null }>();
    if (!connector || !owned) return response(request, env, { error: "session-not-found" }, { status: 404 });
    if (connector.status !== "online" || !connector.connection_id
      || owned.confirmed_connection_id !== connector.connection_id || body.connectionId !== connector.connection_id) {
      return response(request, env, { error: "native-session-state-unconfirmed" }, { status: 409 });
    }
    if (!connectorCapabilitiesSchema.parse(JSON.parse(connector.capabilities_json)).setNativeArchive
      || owned.can_set_native_archive !== 1 || owned.native_archived === null) {
      return response(request, env, { error: "native-done-restore-unsupported" }, { status: 409 });
    }
    const command = setSessionArchiveCommandSchema.parse({
      type: "session.archive", protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(),
      sessionId: agentSessionId.data, archived: workState.data === "completed", connectionId: connector.connection_id,
    });
    const delivered = await dispatchCommand(env, session.userId, connectorId.data, command);
    return response(request, env, {
      command: { id: command.commandId, type: command.type, status: delivered ? "sent" : "failed" },
      ...(!delivered ? { error: "command-not-delivered" } : {}),
    }, { status: delivered ? 202 : 409 });
  }

  const sessionMessageMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/messages$/u.exec(path);
  if (request.method === "POST" && sessionMessageMatch) {
    const connectorId = pathValue(sessionMessageMatch[1]);
    const agentSessionId = pathValue(sessionMessageMatch[2]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    const parsedSessionId = sessionIdSchema.safeParse(agentSessionId);
    if (!parsedConnectorId.success || !parsedSessionId.success) {
      return response(
        request,
        env,
        { error: "invalid-session-route" },
        { status: 400 },
      );
    }
    const owned = await env.DB.prepare(
      `SELECT s.can_send_message, s.capability_confirmed, s.confirmed_connection_id, s.work_state, s.native_archived,
          c.connection_id, c.status, c.capabilities_json
       FROM agent_sessions s JOIN connectors c ON c.user_id = s.user_id AND c.id = s.connector_id
       WHERE s.user_id = ?1 AND s.connector_id = ?2 AND s.id = ?3`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first<{
        can_send_message: number;
        capability_confirmed: number;
        confirmed_connection_id: string | null;
        connection_id: string | null;
        status: string;
        capabilities_json: string;
        work_state: SessionWorkState;
        native_archived: number | null;
      }>();
    if (!owned) {
      return response(
        request,
        env,
        { error: "session-not-found" },
        { status: 404 },
      );
    }
    if (owned.native_archived === 1 || (owned.native_archived === null && owned.work_state === "completed")) {
      return response(request, env, { error: "session-completed-reactivate-first" }, { status: 409 });
    }
    const body = await requestBody(request);
    if (
      owned.status !== "online"
      || !owned.connection_id
      || owned.confirmed_connection_id !== owned.connection_id
      || owned.capability_confirmed !== 1
      || body.connectionId !== owned.connection_id
      || !connectorCapabilitiesSchema.parse(JSON.parse(owned.capabilities_json)).sendMessage
    ) {
      return response(request, env, { error: "session-state-unconfirmed" }, { status: 409 });
    }
    if (owned.can_send_message === 0) {
      return response(request, env, { error: "session-read-only" }, { status: 409 });
    }
    const command = sendSessionMessageCommandSchema.safeParse({
      type: "session.message",
      protocolVersion: PROTOCOL_VERSION,
      commandId: crypto.randomUUID(),
      sessionId: parsedSessionId.data,
      message: body.message,
      connectionId: owned.connection_id,
    });
    if (!command.success) {
      return response(
        request,
        env,
        { error: "invalid-session-message" },
        { status: 400 },
      );
    }
    const delivered = await dispatchCommand(
      env,
      session.userId,
      parsedConnectorId.data,
      command.data,
    );
    const currentWorkState = delivered ? null : await env.DB.prepare(
      `SELECT CASE WHEN native_archived IS NULL THEN work_state
         WHEN native_archived = 1 THEN 'completed' ELSE 'open' END AS work_state
       FROM agent_sessions WHERE user_id = ?1 AND connector_id = ?2 AND id = ?3`,
    ).bind(session.userId, parsedConnectorId.data, parsedSessionId.data)
      .first<SessionWorkState>("work_state");
    return response(
      request,
      env,
      {
        command: {
          id: command.data.commandId,
          type: command.data.type,
          status: delivered ? "sent" : "failed",
        },
        ...(delivered ? {} : {
          error: currentWorkState === "completed" ? "session-completed-reactivate-first" : "connector-offline",
        }),
      },
      { status: delivered ? 202 : 409 },
    );
  }

  const commandMatch = /^\/api\/commands\/([0-9a-f-]{36})$/u.exec(path);
  if (request.method === "GET" && commandMatch) {
    const command = await env.DB.prepare(
      `SELECT id, connector_id, type, session_id, status, error_code,
        error_message, created_at, updated_at, sent_at, accepted_at,
        completed_at, result_uncertain_at
       FROM connector_commands WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(commandMatch[1], session.userId)
      .first<{
        id: string;
        connector_id: string;
        type: string;
        session_id: string | null;
        status: string;
        error_code: string | null;
        error_message: string | null;
        created_at: string;
        updated_at: string;
        sent_at: string | null;
        accepted_at: string | null;
        completed_at: string | null;
        result_uncertain_at: string | null;
      }>();
    if (!command) {
      return response(
        request,
        env,
        { error: "command-not-found" },
        { status: 404 },
      );
    }
    return response(request, env, {
      id: command.id,
      connectorId: command.connector_id,
      type: command.type,
      sessionId: command.session_id,
      status: command.result_uncertain_at && ["sent", "accepted"].includes(command.status)
        ? "unknown" : command.status,
      error: command.error_code
        ? {
            code: command.error_code,
            message: command.error_message,
          }
        : null,
      createdAt: command.created_at,
      updatedAt: command.updated_at,
      sentAt: command.sent_at,
      acceptedAt: command.accepted_at,
      completedAt: command.completed_at,
    });
  }

  const sessionMatch = /^\/api\/sessions\/([A-Za-z0-9_-]{16})$/u.exec(path);
  if (request.method === "DELETE" && sessionMatch) {
    const revoked = await env.DB.prepare(
      `UPDATE browser_sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
    )
      .bind(sessionMatch[1], session.userId)
      .run();
    const result = response(
      request,
      env,
      { revoked: revoked.meta.changes === 1 },
      { status: revoked.meta.changes === 1 ? 200 : 404 },
    );
    return sessionMatch[1] === session.id
      ? clearSessionCookies(result, env)
      : result;
  }

  const identityMatch = /^\/api\/identities\/(google|microsoft|github)$/u.exec(path);
  if (request.method === "DELETE" && identityMatch) {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM external_identities WHERE user_id = ?1",
    )
      .bind(session.userId)
      .first<{ count: number }>();
    if ((count?.count ?? 0) <= 1) {
      return response(request, env, { error: "last-identity" }, { status: 409 });
    }
    const removed = await env.DB.prepare(
      "DELETE FROM external_identities WHERE provider = ?1 AND user_id = ?2",
    )
      .bind(identityMatch[1], session.userId)
      .run();
    return response(
      request,
      env,
      { removed: removed.meta.changes === 1 },
      { status: removed.meta.changes === 1 ? 200 : 404 },
    );
  }

  if (request.method === "GET" && path === "/api/tokens") {
    return response(request, env, await listTokens(env, session.userId));
  }
  if (request.method === "POST" && path === "/api/tokens") {
    try {
      return response(
        request,
        env,
        await createToken(env, session.userId, await requestBody(request)),
        { status: 201 },
      );
    } catch (error) {
      return response(
        request,
        env,
        { error: error instanceof Error ? error.message : "token-create-failed" },
        { status: 400 },
      );
    }
  }

  const rotateMatch = /^\/api\/tokens\/([A-Za-z0-9_-]{16})\/rotate$/u.exec(path);
  if (request.method === "POST" && rotateMatch) {
    try {
      const rotated = await rotateToken(env, session.userId, rotateMatch[1]);
      context.waitUntil(notifyTokenRevocation(env, session.userId, rotateMatch[1]));
      return response(request, env, rotated, { status: 201 });
    } catch (error) {
      return response(
        request,
        env,
        { error: error instanceof Error ? error.message : "token-rotation-failed" },
        { status: 409 },
      );
    }
  }

  const tokenMatch = /^\/api\/tokens\/([A-Za-z0-9_-]{16})$/u.exec(path);
  if (request.method === "DELETE" && tokenMatch) {
    const revoked = await revokeToken(env, session.userId, tokenMatch[1]);
    if (revoked) {
      context.waitUntil(notifyTokenRevocation(env, session.userId, tokenMatch[1]));
    }
    return response(
      request,
      env,
      { revoked },
      { status: revoked ? 200 : 404 },
    );
  }
  return response(request, env, { error: "not-found" }, { status: 404 });
}
