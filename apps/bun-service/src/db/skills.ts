/**
 * SkillsDb adapter against `bun:sqlite`.
 *
 * SkillsRegistry already implements all the SQL it needs against a thin
 * `SkillsDb { run(sql, params?), all<T>(sql, params?) }` interface; this
 * adapter just plumbs `bun:sqlite`'s `Database#run` / `query().all()` into
 * that shape so the registry persists into the main app DB.
 *
 * The schema realignment in migration 003-skills-realign.sql ensures the
 * existing `skills` table matches the registry's expected columns
 * (ISO-string timestamps + NOT NULL on file_path/skill_type).
 */

import type { Database } from "bun:sqlite";

import type { SkillsDb } from "../skills/registry.ts";

export class BunSqliteSkillsDb implements SkillsDb {
  constructor(private readonly db: Database) {}

  run(sql: string, params: unknown[] = []): void {
    // SkillsRegistry calls `run(CREATE_TABLE_SQL)` at construction. That's
    // an idempotent `CREATE IF NOT EXISTS` and matches our migration's
    // shape, so we can run it through verbatim.
    this.db.query(sql).run(...(params as never[]));
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.query(sql).all(...(params as never[])) as T[];
  }
}
