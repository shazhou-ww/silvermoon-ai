import { handleApi } from "./api";
import { authenticate } from "./auth";
import type { AppEnv } from "./env";
import { completeOAuth, beginOAuth } from "./oauth";
import { handleStreamApi } from "./stream-api";
export { ConnectorSession as DaemonSession } from "./connector-session";
export { DeviceSync } from "./device-sync";

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function connectConnector(
  request: Request,
  env: AppEnv,
  context: ExecutionContext,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "websocket-upgrade-required");
  }
  const connection = await authenticate(request, env, context);
  if (!connection) return jsonError(401, "unauthorized");

  const registration = await env.DB.prepare(
    `UPDATE connectors SET connection_token_id = ?1
     WHERE user_id = ?2 AND id = ?3
       AND EXISTS (SELECT 1 FROM devices
         WHERE user_id = ?2 AND id = ?3 AND removed_at IS NULL)
       AND EXISTS (SELECT 1 FROM connection_tokens
         WHERE id = ?1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR julianday(expires_at) > julianday('now')))`,
  )
    .bind(connection.tokenId, connection.userId, connection.deviceId)
    .run();
  if (registration.meta.changes !== 1) {
    return jsonError(409, "device-registration-missing");
  }

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-silvermoon-user-id", connection.userId);
  headers.set("x-silvermoon-token-id", connection.tokenId);
  headers.set("x-silvermoon-connector-id", connection.deviceId);
  headers.set("x-silvermoon-device-name", connection.displayName);
  return env.DAEMON_SESSIONS.getByName(
    connection.tokenId,
  ).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/stream-connectors" || url.pathname.startsWith("/api/stream-connectors/")) {
      return handleStreamApi(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/sync") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError(426, "websocket-upgrade-required");
      const auth = await authenticate(request, env, context);
      if (!auth) return jsonError(401, "unauthorized");
      const headers = new Headers({
        upgrade: "websocket",
        "x-sync-user": auth.userId,
        "x-sync-device": auth.deviceId,
        "x-sync-token": auth.tokenId,
      });
      return env.DEVICE_SYNC.getByName(JSON.stringify([auth.userId, auth.deviceId]))
        .fetch(new Request(request, { headers }));
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "silvermoon-relay", status: "ok" });
    }

    const authMatch = /^\/auth\/(google|microsoft|github)\/(start|callback)$/u
      .exec(url.pathname);
    if (request.method === "GET" && authMatch) {
      return authMatch[2] === "start"
        ? beginOAuth(request, env, authMatch[1])
        : completeOAuth(request, env, authMatch[1]);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, context);
    }

    const connectorMatch = /^\/v1\/connectors\/([^/]+)\/connect$/u
      .exec(url.pathname);
    if (request.method === "GET" && connectorMatch) {
      return connectConnector(request, env, context);
    }

    if (
      request.method === "GET"
      && (url.pathname === "/v1/connect"
        || url.pathname === "/v1/daemon/connect")
    ) {
      return connectConnector(request, env, context);
    }
    return jsonError(404, "not-found");
  },
} satisfies ExportedHandler<AppEnv>;
