import { Database } from "bun:sqlite";

export interface MemoryEntry {
  id: number;
  kind: string;
  content: string;
  metadata: string | null;
  created_at: number;
}

export interface NewMemoryEntry {
  kind?: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface SearchHit extends MemoryEntry {
  rank: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'episodic',
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  content='memory',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

export class MemoryStore {
  readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? new Database(":memory:");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SCHEMA_SQL);
  }

  add(entry: NewMemoryEntry): MemoryEntry {
    const kind = entry.kind ?? "episodic";
    const metadata =
      entry.metadata == null ? null : JSON.stringify(entry.metadata);
    const row = this.db
      .query<MemoryEntry, [string, string, string | null]>(
        `INSERT INTO memory (kind, content, metadata)
         VALUES (?, ?, ?)
         RETURNING id, kind, content, metadata, created_at`,
      )
      .get(kind, entry.content, metadata);
    if (!row) throw new Error("memory insert returned no row");
    return row;
  }

  search(query: string, k = 10): SearchHit[] {
    const fts = sanitizeFtsQuery(query);
    if (!fts) return [];
    return this.db
      .query<SearchHit, [string, number]>(
        `SELECT m.id, m.kind, m.content, m.metadata, m.created_at, memory_fts.rank AS rank
         FROM memory_fts
         JOIN memory m ON m.id = memory_fts.rowid
         WHERE memory_fts MATCH ?
         ORDER BY memory_fts.rank
         LIMIT ?`,
      )
      .all(fts, k);
  }

  getRecent(n = 20): MemoryEntry[] {
    return this.db
      .query<MemoryEntry, [number]>(
        `SELECT id, kind, content, metadata, created_at
         FROM memory
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(n);
  }

  getByIds(ids: number[]): MemoryEntry[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    return this.db
      .query<MemoryEntry, number[]>(
        `SELECT id, kind, content, metadata, created_at
         FROM memory
         WHERE id IN (${placeholders})
         ORDER BY id DESC`,
      )
      .all(...ids);
  }

  delete(id: number): boolean {
    const res = this.db.run(`DELETE FROM memory WHERE id = ?`, [id]);
    return res.changes > 0;
  }

  count(): number {
    const row = this.db
      .query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM memory`)
      .get();
    return row?.c ?? 0;
  }

  close(): void {
    this.db.close();
  }
}

// FTS5 MATCH treats some characters as operators. Escape user input by
// wrapping each whitespace-delimited token in double quotes (with internal
// quotes doubled per FTS5 quoting rules).
function sanitizeFtsQuery(input: string): string {
  return input
    .split(/\s+/)
    .map((tok) => tok.replace(/"/g, '""'))
    .filter((tok) => tok.length > 0)
    .map((tok) => `"${tok}"`)
    .join(" ");
}
