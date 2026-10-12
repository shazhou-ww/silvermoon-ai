ALTER TABLE agent_sessions ADD COLUMN can_set_native_archive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN native_archived INTEGER;
