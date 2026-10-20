import { DUPLEX_LIMITS, DuplexError } from "@silvermoon-ai/sync-protocol/duplex";
import { authenticate } from "./auth";
import type { MessagePrincipal, Result } from "./account-messages";
import type { AppEnv } from "./env";
import { isAllowedOrigin, withCors } from "./http";
import { readSession, verifyCsrf } from "./session";

async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new DuplexError("invalid_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DUPLEX_LIMITS.requestBytes) throw new DuplexError("payload_too_large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new DuplexError("invalid_request"); }
}

function status(error: string): number {
  if (error === "relay_unavailable") return 503;
  if (error === "unauthorized") return 401;
  if (["forbidden", "write_permission_required"].includes(error)) return 403;
  if (error === "device_not_found") return 404;
  if (["idempotency_conflict", "stale_generation", "lease_conflict", "cursor_ahead"].includes(error)) return 409;
  if (error === "cursor_expired") return 410;
  if (["quota_exceeded", "rate_limited", "backpressure"].includes(error)) return 429;
  if (error === "payload_too_large") return 413;
  return 400;
}

export async function handleMessageApi(request: Request, env: AppEnv): Promise<Response> {
  const reply = (value: unknown, code = 200) => withCors(Response.json(value, {
    status: code, headers: { "cache-control": "no-store" },
  }), request, env);
  const finish = <T>(result: Result<T>) => "error" in result ? reply(result, status(result.error)) : reply(result.value);
  let operation = "route";
  let role: "device" | "client" | undefined;
  try {
    const url = new URL(request.url);
    const deviceRoute = /^\/v2\/devices\/([^/]+)\/(lease|events|regulations|ack)$/u.exec(url.pathname);
    const clientRoute = /^\/api\/v2\/account\/(events|write-access)$/u.exec(url.pathname)
      ?? /^\/api\/v2\/devices\/([^/]+)\/(regulations)$/u.exec(url.pathname);
    if (!deviceRoute && !clientRoute) return reply({ error: "not_found", retryable: false }, 404);
    operation = deviceRoute?.[2] ?? clientRoute![2] ?? clientRoute![1];
    role = deviceRoute ? "device" : "client";
    if (request.method === "OPTIONS" && clientRoute && isAllowedOrigin(request, env)) {
      const response = reply(null);
      response.headers.set("access-control-allow-methods", "GET, POST");
      response.headers.set("access-control-allow-headers", "content-type, x-csrf-token");
      return response;
    }
    let principal: MessagePrincipal;
    if (deviceRoute) {
      const auth = await authenticate(request, env);
      if (!auth) throw new DuplexError("unauthorized");
      if (decodeURIComponent(deviceRoute[1]) !== auth.deviceId) throw new DuplexError("forbidden");
      principal = { account: auth.userId, role: "device", device: auth.deviceId, token: auth.tokenId };
    } else {
      if (!isAllowedOrigin(request, env) || request.headers.has("authorization")) throw new DuplexError("forbidden");
      const session = await readSession(request, env);
      if (!session) throw new DuplexError("unauthorized");
      if (request.method !== "GET" && !await verifyCsrf(request, session, env)) throw new DuplexError("forbidden");
      principal = { account: session.userId, role: "client", session: session.id };
    }
    const stub = env.ACCOUNT_MESSAGES.getByName(principal.account);
    const generation = request.headers.get("x-device-generation") ?? "0";
    const owner = request.headers.get("x-device-owner") ?? "";
    if (request.method === "GET") {
      if (deviceRoute?.[2] !== "regulations" && url.pathname !== "/api/v2/account/events") return reply({ error: "method_not_allowed", retryable: false }, 405);
      const result = await stub.read(principal, url.searchParams.get("after") ?? "0", generation, owner, Number(url.searchParams.get("wait") ?? "0"));
      return "error" in result ? finish(result) : reply(JSON.parse(result.value));
    }
    if (request.method !== "POST") return reply({ error: "method_not_allowed", retryable: false }, 405);
    const input = await body(request);
    if (url.pathname === "/api/v2/account/write-access") {
      if (typeof input.enabled !== "boolean" || Object.keys(input).length !== 1) throw new DuplexError("invalid_request");
      return finish(await stub.grant(principal, input.enabled));
    }
    if (deviceRoute?.[2] === "lease") {
      if (!["acquire", "renew", "release"].includes(String(input.action)) || typeof input.owner !== "string"
        || (input.takeover !== undefined && typeof input.takeover !== "boolean")) throw new DuplexError("invalid_request");
      return finish(await stub.ownership(principal, input.action as "acquire" | "renew" | "release", input.owner, generation, input.takeover === true));
    }
    if (deviceRoute?.[2] === "ack") {
      if (typeof input.id !== "string") throw new DuplexError("invalid_cursor");
      return finish(await stub.acknowledge(principal, input.id, generation, owner));
    }
    if (deviceRoute?.[2] === "events") return finish(await stub.append(principal, principal.role === "device" ? principal.device : "", input, generation, owner));
    if (clientRoute?.[2] === "regulations") return finish(await stub.append(principal, decodeURIComponent(clientRoute[1]), input));
    return reply({ error: "method_not_allowed", retryable: false }, 405);
  } catch (error) {
    if (error instanceof DuplexError) return reply({ error: error.code, retryable: error.retryable }, status(error.code));
    // Do not expose request bodies, credentials or internal database errors.
    console.error(JSON.stringify({
      event: "message_api.failed", operation, role,
      method: ["GET", "POST", "OPTIONS"].includes(request.method) ? request.method : "other",
      failure: error instanceof Error ? "unexpected_exception" : "unexpected_value",
    }));
    return reply({ error: "relay_unavailable", retryable: true }, 503);
  }
}
