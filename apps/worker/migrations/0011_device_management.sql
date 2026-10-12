ALTER TABLE devices ADD COLUMN removed_at TEXT;
ALTER TABLE devices ADD COLUMN disconnect_requested_at TEXT;

CREATE TRIGGER devices_cannot_restore
BEFORE UPDATE OF removed_at ON devices
WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NOT OLD.removed_at
BEGIN
  SELECT RAISE(ABORT, 'device removal is irreversible');
END;

CREATE TRIGGER devices_sync_name
AFTER UPDATE OF display_name ON devices
BEGIN
  UPDATE connectors SET display_name = NEW.display_name
  WHERE user_id = NEW.user_id AND id = NEW.id;
END;

CREATE TRIGGER devices_remove_access
AFTER UPDATE OF removed_at ON devices
WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
BEGIN
  UPDATE connection_tokens SET revoked_at = COALESCE(revoked_at, NEW.removed_at)
  WHERE user_id = NEW.user_id AND device_id = NEW.id;
  UPDATE connectors SET status = 'offline', connection_id = NULL,
    disconnected_at = NEW.removed_at
  WHERE user_id = NEW.user_id AND id = NEW.id;
  UPDATE connector_commands SET status = 'failed', error_code = 'device-removed',
    error_message = 'The Device was removed before this command was delivered.',
    completed_at = NEW.removed_at, updated_at = NEW.removed_at
  WHERE user_id = NEW.user_id AND connector_id = NEW.id AND status = 'queued';
  UPDATE connector_commands SET result_uncertain_at = NEW.removed_at,
    error_code = 'command-result-unconfirmed',
    error_message = 'The Device was removed; the command result is not confirmed.',
    updated_at = NEW.removed_at
  WHERE user_id = NEW.user_id AND connector_id = NEW.id AND status IN ('sent', 'accepted');
END;

CREATE TRIGGER removed_devices_cannot_issue_tokens
BEFORE INSERT ON connection_tokens
WHEN EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.device_id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;

CREATE TRIGGER removed_devices_cannot_enable_tokens
BEFORE UPDATE ON connection_tokens
WHEN NEW.revoked_at IS NULL AND EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.device_id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;

CREATE TRIGGER removed_devices_cannot_connect
BEFORE UPDATE ON connectors
WHEN (NEW.status != 'offline' OR NEW.connection_id IS NOT NULL
  OR NEW.connection_token_id IS NOT OLD.connection_token_id)
AND EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;

CREATE TRIGGER removed_devices_cannot_insert_sessions
BEFORE INSERT ON agent_sessions
WHEN EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.connector_id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;

CREATE TRIGGER removed_devices_cannot_update_sessions
BEFORE UPDATE ON agent_sessions
WHEN EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.connector_id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;

CREATE TRIGGER removed_devices_cannot_insert_events
BEFORE INSERT ON agent_session_events
WHEN EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.connector_id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;

CREATE TRIGGER removed_devices_cannot_update_events
BEFORE UPDATE ON agent_session_events
WHEN EXISTS (
  SELECT 1 FROM devices WHERE user_id = NEW.user_id AND id = NEW.connector_id AND removed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'device-removed');
END;
