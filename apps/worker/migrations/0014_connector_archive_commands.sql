PRAGMA defer_foreign_keys = ON;
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS devices_remove_access;

CREATE TABLE connector_commands_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN (
      'sessions.list',
      'session.create',
      'session.message',
      'session.history',
      'session.archive'
    )),
  session_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN (
      'queued',
      'sent',
      'accepted',
      'succeeded',
      'failed'
    )),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  accepted_at TEXT,
  completed_at TEXT,
  connection_id TEXT,
  result_uncertain_at TEXT,
  FOREIGN KEY (user_id, connector_id)
    REFERENCES connectors(user_id, id) ON DELETE CASCADE
);

INSERT INTO connector_commands_new (
  id,
  user_id,
  connector_id,
  type,
  session_id,
  payload_json,
  status,
  error_code,
  error_message,
  created_at,
  updated_at,
  sent_at,
  accepted_at,
  completed_at,
  connection_id,
  result_uncertain_at
)
SELECT
  id,
  user_id,
  connector_id,
  type,
  session_id,
  payload_json,
  status,
  error_code,
  error_message,
  created_at,
  updated_at,
  sent_at,
  accepted_at,
  completed_at,
  connection_id,
  result_uncertain_at
FROM connector_commands;

DROP TABLE connector_commands;
ALTER TABLE connector_commands_new RENAME TO connector_commands;

CREATE INDEX connector_commands_by_connector_created
  ON connector_commands (user_id, connector_id, created_at DESC);

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

PRAGMA foreign_keys = ON;
