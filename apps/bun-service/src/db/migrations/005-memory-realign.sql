-- Realign the memory + memory_fts schema to match MemoryStore's expected
-- shape (id INTEGER, content/metadata, FTS5 on `content`). The original
-- 001-memory.sql used TEXT id + body/tags. Nothing has been persisted to
-- this table yet (MemoryStore was using its own private DB) so a
-- destructive recreate is safe.

DROP TRIGGER IF EXISTS memory_au;
DROP TRIGGER IF EXISTS memory_ad;
DROP TRIGGER IF EXISTS memory_ai;
DROP TABLE IF EXISTS memory_fts;
DROP TABLE IF EXISTS memory;

CREATE TABLE memory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'episodic',
  content    TEXT NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  content='memory',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;
