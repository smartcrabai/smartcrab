-- Realign the skills table to the shape SkillsRegistry expects (ISO-string
-- timestamps + NOT NULL on file_path/skill_type). The original 000-init
-- schema used INTEGER timestamps and a UNIQUE constraint on name; nothing
-- has been persisted yet (skills was in-memory only) so a destructive
-- recreate is safe.

DROP TABLE IF EXISTS skills;

CREATE TABLE skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  file_path   TEXT NOT NULL,
  skill_type  TEXT NOT NULL,
  pipeline_id TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  body        TEXT
);
