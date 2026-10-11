ALTER TABLE connectors ADD COLUMN connection_id TEXT;
ALTER TABLE connectors ADD COLUMN session_sync_state TEXT NOT NULL DEFAULT 'unsupported'
  CHECK (session_sync_state IN ('unsupported', 'pending', 'ready', 'failed'));
ALTER TABLE connectors ADD COLUMN session_sync_error TEXT;

ALTER TABLE agent_sessions ADD COLUMN confirmed_connection_id TEXT;
ALTER TABLE agent_sessions ADD COLUMN observation_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN execution_state_known INTEGER NOT NULL DEFAULT 0
  CHECK (execution_state_known IN (0, 1));
ALTER TABLE agent_sessions ADD COLUMN capability_confirmed INTEGER NOT NULL DEFAULT 0
  CHECK (capability_confirmed IN (0, 1));

ALTER TABLE connector_commands ADD COLUMN connection_id TEXT;
ALTER TABLE connector_commands ADD COLUMN result_uncertain_at TEXT;
