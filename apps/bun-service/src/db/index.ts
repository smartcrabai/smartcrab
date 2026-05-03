import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Static `with { type: "text" }` imports let bun:build --compile embed the SQL
// into the binary. Bun does not support Vite-style `import.meta.glob`, so each
// migration file must be listed explicitly in MIGRATIONS below.
import init000 from "./migrations/000-init.sql" with { type: "text" };
import memory001 from "./migrations/001-memory.sql" with { type: "text" };
import seher002 from "./migrations/002-seher-config.sql" with { type: "text" };

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  { name: "000-init", sql: init000 },
  { name: "001-memory", sql: memory001 },
  { name: "002-seher-config", sql: seher002 },
];

export interface OpenOptions {
  /** Override the database path. Use `:memory:` for an in-memory DB. */
  path?: string;
}

/**
 * Default location of the application database on disk.
 * Honours `SMARTCRAB_DB_PATH` for tests / overrides.
 */
export function defaultDbPath(): string {
  const override = process.env.SMARTCRAB_DB_PATH;
  if (override) return override;
  return join(homedir(), "Library", "Application Support", "SmartCrab", "smartcrab.db");
}

/**
 * Open (or create) the SmartCrab database, configure pragmas, and
 * apply any pending migrations. Safe to call repeatedly.
 */
export function openDb(options: OpenOptions = {}): Database {
  const path = options.path ?? defaultDbPath();

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  return db;
}

/**
 * Apply migrations recorded in MIGRATIONS that have not yet been applied,
 * in ascending file-name order. Idempotent.
 */
export function runMigrations(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const isApplied = db.query<{ name: string }, [string]>(
    "SELECT name FROM _migrations WHERE name = ?",
  );

  // Defensive: sort by file-name even if MIGRATIONS is already declared in order.
  const ordered = [...MIGRATIONS].sort((a, b) => a.name.localeCompare(b.name));

  for (const migration of ordered) {
    if (isApplied.get(migration.name)) continue;

    db.transaction(() => {
      db.exec(migration.sql);
      db.run("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [
        migration.name,
        Date.now(),
      ]);
    })();
  }
}

/** Exposed for tests and tooling. */
export const __migrations = MIGRATIONS;
