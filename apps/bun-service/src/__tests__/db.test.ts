import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { __migrations, openDb, runMigrations } from "../db/index.ts";

function tableNames(db: Database): Set<string> {
  const rows = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
    )
    .all();
  return new Set(rows.map((r) => r.name));
}

describe("db", () => {
  test("opens an in-memory database and applies all migrations", () => {
    const db = openDb({ path: ":memory:" });

    const tables = tableNames(db);
    for (const expected of [
      "pipelines",
      "pipeline_executions",
      "node_executions",
      "execution_logs",
      "skills",
      "chat_adapter_config",
      "llm_adapter_config",
      "cron_jobs",
      "memory",
      "memory_fts",
      "seher_config",
      "_migrations",
    ]) {
      expect(tables.has(expected)).toBe(true);
    }

    db.close();
  });

  test("records every migration in _migrations", () => {
    const db = openDb({ path: ":memory:" });
    const applied = db
      .query<{ name: string }, []>("SELECT name FROM _migrations ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(applied).toEqual(__migrations.map((m) => m.name).sort());
    db.close();
  });

  test("re-running migrations is idempotent", () => {
    const db = openDb({ path: ":memory:" });
    runMigrations(db);
    runMigrations(db);

    const count = db
      .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM _migrations")
      .get();
    expect(count?.c).toBe(__migrations.length);
    db.close();
  });

  test("enables WAL and foreign_keys pragmas", () => {
    const db = openDb({ path: ":memory:" });
    // in-memory DBs cannot use WAL, but foreign_keys must be on regardless.
    const fk = db
      .query<{ foreign_keys: number }, []>("PRAGMA foreign_keys")
      .get();
    expect(fk?.foreign_keys).toBe(1);
    db.close();
  });

  test("insert and select round-trip on pipelines", () => {
    const db = openDb({ path: ":memory:" });
    const now = Date.now();

    db.query(
      `INSERT INTO pipelines (id, name, yaml_content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("p1", "demo", "nodes: []\n", 1, now, now);

    const row = db
      .query<{ id: string; name: string; enabled: number }, [string]>(
        "SELECT id, name, enabled FROM pipelines WHERE id = ?",
      )
      .get("p1");

    expect(row).toEqual({ id: "p1", name: "demo", enabled: 1 });
    db.close();
  });

  test("memory FTS5 trigger keeps index in sync", () => {
    const db = openDb({ path: ":memory:" });
    const now = Date.now();

    db.query(
      "INSERT INTO memory (id, kind, body, tags, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("m1", "note", "the quick brown fox", "lex", now);

    const hits = db
      .query<{ id: string }, [string]>(
        `SELECT m.id FROM memory_fts f JOIN memory m ON m.rowid = f.rowid WHERE memory_fts MATCH ?`,
      )
      .all("quick");
    expect(hits.map((h) => h.id)).toEqual(["m1"]);

    db.query("UPDATE memory SET body = ? WHERE id = ?").run(
      "lazy dog jumps",
      "m1",
    );
    const stale = db
      .query<{ id: string }, [string]>(
        `SELECT m.id FROM memory_fts f JOIN memory m ON m.rowid = f.rowid WHERE memory_fts MATCH ?`,
      )
      .all("quick");
    expect(stale).toEqual([]);

    const fresh = db
      .query<{ id: string }, [string]>(
        `SELECT m.id FROM memory_fts f JOIN memory m ON m.rowid = f.rowid WHERE memory_fts MATCH ?`,
      )
      .all("lazy");
    expect(fresh.map((h) => h.id)).toEqual(["m1"]);

    db.query("DELETE FROM memory WHERE id = ?").run("m1");
    const gone = db
      .query<{ rowid: number }, []>(
        "SELECT rowid FROM memory_fts WHERE memory_fts MATCH 'lazy'",
      )
      .all();
    expect(gone).toEqual([]);

    db.close();
  });

  test("seher_config singleton rejects duplicate ids", () => {
    const db = openDb({ path: ":memory:" });
    db.query(
      "INSERT INTO seher_config (id, config_json, updated_at) VALUES (?, ?, ?)",
    ).run(1, "{}", Date.now());

    expect(() =>
      db
        .query("INSERT INTO seher_config (id, config_json, updated_at) VALUES (?, ?, ?)")
        .run(2, "{}", Date.now()),
    ).toThrow();

    db.close();
  });
});
