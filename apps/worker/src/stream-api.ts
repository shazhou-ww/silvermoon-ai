import { SyncError } from "@silvermoon-ai/sync-protocol";
import type { AppEnv } from "./env";
import { isAllowedOrigin, withCors } from "./http";
import { readSession } from "./session";

// These routes deliberately never call token authentication or return device credentials.
export async function handleStreamApi(request: Request, env: AppEnv): Promise<Response> {
  const reply = (value: unknown, status = 200) => withCors(Response.json(value, {
    status, headers: { "cache-control": "no-store" },
  }), request, env);
  const url = new URL(request.url);
  const subscribe = url.pathname.endsWith("/subscribe");
  if (!isAllowedOrigin(request, env)) return reply({ error: "origin-forbidden" }, 403);
  if (request.method === "OPTIONS") {
    const response = reply(null);
    response.headers.set("access-control-allow-methods", "GET");
    return response;
  }
  if (request.method !== "GET") return reply({ error: "read-only" }, 405);
  const session = await readSession(request, env);
  if (!session) return reply({ error: "authentication-required" }, 401);
  try {
    if (url.pathname === "/api/stream-connectors") {
      const after = url.searchParams.get("after") ?? "";
      const rows = await env.DB.prepare(`SELECT id, display_name AS displayName FROM devices
        WHERE user_id=?1 AND removed_at IS NULL AND id>?2 ORDER BY id LIMIT 33`)
        .bind(session.userId, after).all<{ id: string; displayName: string }>();
      const devices = await Promise.all(rows.results.slice(0, 32).map(async device => {
        const result = await env.DEVICE_SYNC.getByName(JSON.stringify([session.userId, device.id]))
          .browserRead(session.userId, device.id, session.id, JSON.stringify({ type: "ping", requestId: "status" }));
        if ("error" in result) throw new SyncError(result.error);
        if (!("status" in result)) throw new Error("invalid-status-result");
        return { ...device, status: result.status };
      }));
      return reply({ devices, next: rows.results.length > 32 ? devices.at(-1)!.id : null });
    }
    const match = /^\/api\/stream-connectors\/([^/]+)\/(streams|events|subscribe)$/u.exec(url.pathname);
    if (!match) return reply({ error: "not-found" }, 404);
    const deviceId = decodeURIComponent(match[1]);
    const device = await env.DB.prepare("SELECT id FROM devices WHERE user_id=? AND id=? AND removed_at IS NULL")
      .bind(session.userId, deviceId).first();
    if (!device) return reply({ error: "device-not-found" }, 404);
    const stub = env.DEVICE_SYNC.getByName(JSON.stringify([session.userId, deviceId]));
    if (subscribe) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return reply({ error: "websocket-upgrade-required" }, 426);
      return stub.fetch(new Request(request, { headers: {
        upgrade: "websocket", "x-sync-user": session.userId,
        "x-sync-device": deviceId, "x-sync-session": session.id,
      } }));
    }
    const input = match[2] === "streams"
      ? { type: "stream.list", requestId: "list", ...(url.searchParams.has("after") ? { after: url.searchParams.get("after") } : {}), limit: 32 }
      : { type: "stream.read", requestId: "read", streamId: url.searchParams.get("streamId"), after: url.searchParams.get("before") ?? url.searchParams.get("after") ?? "0", limit: 128 };
    if (["before", "after", "tail"].filter(key => url.searchParams.has(key)).length > 1) return reply({ error: "ambiguous-cursor" }, 400);
    const result = await stub.browserRead(session.userId, deviceId, session.id, JSON.stringify(input), url.searchParams.has("before"), url.searchParams.get("tail") === "1");
    return "error" in result
      ? reply({ error: result.error === "unauthorized" ? "authentication-required" : result.error }, result.error === "unauthorized" ? 401 : 400)
      : reply(result);
  } catch (error) {
    if (error instanceof SyncError) return reply({ error: error.code === "unauthorized" ? "authentication-required" : error.code }, error.code === "unauthorized" ? 401 : 400);
    // RPC errors may cross the Worker boundary without the custom prototype.
    if (error instanceof Error && error.message === "unauthorized") return reply({ error: "authentication-required" }, 401);
    console.error(JSON.stringify({ event: "stream_read_failed", message: error instanceof Error ? error.message : String(error) }));
    return reply({ error: "stream-read-failed" }, 400);
  }
}
