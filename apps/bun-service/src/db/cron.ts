/**
 * SQLite-backed `CronStore` for the cron runner.
 *
 * Backed by the existing `cron_jobs` table from migration 000-init.sql:
 *   id (TEXT PK), pipeline_id, expression, enabled (INTEGER 0/1),
 *   last_run_at, next_run_at, created_at, updated_at — all integer epoch
 *   seconds for timestamps.
 *
 * Field name mapping vs the in-memory `CronJob`:
 *   schedule  ↔ expression
 *   is_active ↔ enabled (1/0)
 * Timestamps stored as INTEGER epoch seconds, surfaced as ISO-8601
 * strings to keep the JSON-RPC wire shape stable.
 */

import type { Database } from "bun:sqlite";

import type { CronJob, CronStore } from "../cron/runner.ts";

interface Row {
  id: string;
  pipeline_id: string;
  expression: string;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number | null;
  updated_at: number | null;
}

function rowToJob(r: Row): CronJob {
  const fromEpoch = (n: number | null): string | null => (n ? new Date(n * 1000).toISOString() : null);
  const fromEpochRequired = (n: number | null): string =>
    n ? new Date(n * 1000).toISOString() : new Date().toISOString();
  return {
    id: r.id,
    pipeline_id: r.pipeline_id,
    schedule: r.expression,
    is_active: r.enabled === 1,
    last_run_at: fromEpoch(r.last_run_at),
    next_run_at: fromEpoch(r.next_run_at),
    created_at: fromEpochRequired(r.created_at),
    updated_at: fromEpochRequired(r.updated_at),
  };
}

function toEpochSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export class SqliteCronStore implements CronStore {
  constructor(private readonly db: Database) {}

  list(): CronJob[] {
    const rows = this.db
      .query<Row, []>(
        "SELECT id, pipeline_id, expression, enabled, last_run_at, next_run_at, created_at, updated_at FROM cron_jobs ORDER BY created_at ASC, id ASC",
      )
      .all();
    return rows.map(rowToJob);
  }

  get(id: string): CronJob | null {
    const r = this.db
      .query<Row, [string]>(
        "SELECT id, pipeline_id, expression, enabled, last_run_at, next_run_at, created_at, updated_at FROM cron_jobs WHERE id = ?1",
      )
      .get(id);
    return r ? rowToJob(r) : null;
  }

  insert(job: CronJob): void {
    this.db
      .query(
        "INSERT INTO cron_jobs (id, pipeline_id, expression, enabled, last_run_at, next_run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      )
      .run(
        job.id,
        job.pipeline_id,
        job.schedule,
        job.is_active ? 1 : 0,
        toEpochSeconds(job.last_run_at),
        toEpochSeconds(job.next_run_at),
        toEpochSeconds(job.created_at) ?? Math.floor(Date.now() / 1000),
        toEpochSeconds(job.updated_at) ?? Math.floor(Date.now() / 1000),
      );
  }

  update(job: CronJob): void {
    this.db
      .query(
        "UPDATE cron_jobs SET expression = ?2, enabled = ?3, last_run_at = ?4, next_run_at = ?5, updated_at = ?6 WHERE id = ?1",
      )
      .run(
        job.id,
        job.schedule,
        job.is_active ? 1 : 0,
        toEpochSeconds(job.last_run_at),
        toEpochSeconds(job.next_run_at),
        toEpochSeconds(job.updated_at) ?? Math.floor(Date.now() / 1000),
      );
  }

  delete(id: string): boolean {
    const before = this.db
      .query<{ n: number }, []>("SELECT changes() AS n")
      .get()?.n ?? 0;
    this.db.query("DELETE FROM cron_jobs WHERE id = ?1").run(id);
    const after = this.db
      .query<{ n: number }, []>("SELECT changes() AS n")
      .get()?.n ?? 0;
    return after > before;
  }

  markRun(id: string, ranAt: string): void {
    const epoch = toEpochSeconds(ranAt) ?? Math.floor(Date.now() / 1000);
    this.db
      .query("UPDATE cron_jobs SET last_run_at = ?2, updated_at = ?2 WHERE id = ?1")
      .run(id, epoch);
  }
}
