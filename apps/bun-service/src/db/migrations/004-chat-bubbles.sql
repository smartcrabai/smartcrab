-- Persisted chat-bubble history for the SwiftUI Chat tab.

CREATE TABLE IF NOT EXISTS chat_bubbles (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_bubbles_created_at
  ON chat_bubbles(created_at);
