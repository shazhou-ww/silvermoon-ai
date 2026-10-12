ALTER TABLE agent_sessions ADD COLUMN work_state TEXT NOT NULL DEFAULT 'open'
  CHECK (work_state IN ('open', 'completed'));
