import type { AppEnv } from "./env";

export function deviceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) throw new Error("invalid-device-name");
  return name;
}

export async function renameDevice(
  env: AppEnv,
  userId: string,
  id: string,
  value: unknown,
): Promise<boolean> {
  const name = deviceName(value);
  const result = await env.DB.prepare(
    `UPDATE devices SET display_name = ?3
     WHERE user_id = ?1 AND id = ?2 AND removed_at IS NULL`,
  ).bind(userId, id, name).run();
  return result.meta.changes > 0;
}

export async function removeDevice(
  env: AppEnv,
  userId: string,
  id: string,
): Promise<{ removed: true; disconnectRequested: boolean } | null> {
  const owned = await env.DB.prepare(
    "SELECT id FROM devices WHERE user_id = ?1 AND id = ?2",
  ).bind(userId, id).first();
  if (!owned) return null;
  await env.DB.prepare(
    `UPDATE devices SET removed_at = CURRENT_TIMESTAMP
     WHERE user_id = ?1 AND id = ?2 AND removed_at IS NULL`,
  ).bind(userId, id).run();
  const tokens = await env.DB.prepare(
    "SELECT id FROM connection_tokens WHERE user_id = ?1 AND device_id = ?2",
  ).bind(userId, id).all<{ id: string }>();
  const notifications = await Promise.allSettled(tokens.results.map(
    (token) => env.DAEMON_SESSIONS.getByName(token.id).revokeToken(token.id),
  ));
  const failures = notifications.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  for (const failure of failures) {
    console.error(JSON.stringify({
      event: "device.disconnect.failed",
      deviceId: id,
      message: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    }));
  }
  if (failures.length === 0) {
    await env.DB.prepare(
      `UPDATE devices SET disconnect_requested_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND id = ?2 AND removed_at IS NOT NULL`,
    ).bind(userId, id).run();
  }
  return { removed: true, disconnectRequested: failures.length === 0 };
}
