import type { Database } from "bun:sqlite";

import type {
  ExecutionLogRow,
  ExecutionRow,
  PipelineDatabase,
  PipelineRow,
} from "../commands/pipeline.commands.ts";

const EXECUTION_SELECT =
  "SELECT e.id, e.pipeline_id, p.name AS pipeline_name, e.trigger_type, e.trigger_data, e.status, e.started_at, e.ended_at, e.error FROM pipeline_executions e JOIN pipelines p ON p.id = e.pipeline_id";

type ExecutionDbRow = {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  trigger_type: string;
  trigger_data: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  error: string | null;
};

function mapExecutionRow(r: ExecutionDbRow): ExecutionRow {
  return {
    id: r.id,
    pipeline_id: r.pipeline_id,
    pipeline_name: r.pipeline_name,
    trigger_type: r.trigger_type,
    trigger_data: r.trigger_data,
    status: r.status,
    started_at: new Date(r.started_at * 1000).toISOString(),
    completed_at: r.ended_at ? new Date(r.ended_at * 1000).toISOString() : null,
    error_message: r.error,
  };
}

/** Adapter from raw `bun:sqlite` rows to the PipelineDatabase interface
 *  used by pipeline.commands. */
export class SqlitePipelineDatabase implements PipelineDatabase {
  constructor(private readonly db: Database) {}

  listPipelines(): PipelineRow[] {
    // The latest execution per pipeline (started_at ties broken by rowid,
    // matching listExecutions' ordering) so the GUI can flag pipelines whose
    // most recent run failed. A correlated subquery (not a window-function
    // scan over all executions) so the pipeline_id index keeps pipeline.list
    // fast as history grows.
    const rows = this.db
      .query<
        {
          id: string;
          name: string;
          description: string | null;
          yaml_content: string;
          max_loop_count: number;
          enabled: number;
          created_at: number;
          updated_at: number;
          last_execution_status: string | null;
        },
        []
      >(
        `SELECT p.id, p.name, p.description, p.yaml_content, p.max_loop_count, p.enabled, p.created_at, p.updated_at,
                (SELECT e.status FROM pipeline_executions e
                 WHERE e.pipeline_id = p.id
                 ORDER BY e.started_at DESC, e.rowid DESC
                 LIMIT 1) AS last_execution_status
         FROM pipelines p
         ORDER BY p.name ASC`,
      )
      .all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      yaml_content: r.yaml_content,
      max_loop_count: r.max_loop_count,
      is_active: r.enabled === 1,
      created_at: new Date(r.created_at * 1000).toISOString(),
      updated_at: new Date(r.updated_at * 1000).toISOString(),
      last_execution_status: r.last_execution_status,
    }));
  }

  getPipeline(id: string): PipelineRow | null {
    type Row = {
      id: string;
      name: string;
      description: string | null;
      yaml_content: string;
      max_loop_count: number;
      enabled: number;
      created_at: number;
      updated_at: number;
    };
    const r = this.db
      .query<Row, [string]>(
        "SELECT id, name, description, yaml_content, max_loop_count, enabled, created_at, updated_at FROM pipelines WHERE id = ?1",
      )
      .get(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      yaml_content: r.yaml_content,
      max_loop_count: r.max_loop_count,
      is_active: r.enabled === 1,
      created_at: new Date(r.created_at * 1000).toISOString(),
      updated_at: new Date(r.updated_at * 1000).toISOString(),
    };
  }
  savePipeline(input: {
    id?: string;
    name: string;
    description?: string | null;
    yaml_content: string;
    max_loop_count?: number;
    is_active?: boolean;
  }): PipelineRow {
    const id = input.id ?? crypto.randomUUID();
    const description = input.description ?? null;
    const maxLoop = input.max_loop_count ?? 10;
    const enabled = input.is_active === false ? 0 : 1;
    const now = Math.floor(Date.now() / 1000);
    this.db
      .query(
        "INSERT INTO pipelines (id, name, description, yaml_content, max_loop_count, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, yaml_content = excluded.yaml_content, max_loop_count = excluded.max_loop_count, enabled = excluded.enabled, updated_at = excluded.updated_at",
      )
      .run(id, input.name, description, input.yaml_content, maxLoop, enabled, now);
    return this.getPipeline(id) as PipelineRow;
  }
  deletePipeline(id: string): void {
    // Dependent rows must go first: with PRAGMA foreign_keys = ON, deleting a
    // pipeline that has executions or cron jobs would otherwise fail with a
    // FOREIGN KEY constraint error.
    //
    // Deleting while an execution is still running is allowed by design: the
    // background loop's remaining log writes fail (caught and reported) and
    // its finalizeExecution becomes a no-op on the vanished row.
    this.db.transaction(() => {
      this.db
        .query(
          "DELETE FROM execution_logs WHERE execution_id IN (SELECT id FROM pipeline_executions WHERE pipeline_id = ?1)",
        )
        .run(id);
      this.db
        .query(
          "DELETE FROM node_executions WHERE execution_id IN (SELECT id FROM pipeline_executions WHERE pipeline_id = ?1)",
        )
        .run(id);
      this.db.query("DELETE FROM pipeline_executions WHERE pipeline_id = ?1").run(id);
      this.db.query("DELETE FROM cron_jobs WHERE pipeline_id = ?1").run(id);
      this.db.query("DELETE FROM pipelines WHERE id = ?1").run(id);
    })();
  }
  insertExecution(row: {
    id: string;
    pipeline_id: string;
    trigger_type: string;
    trigger_data: string | null;
  }): void {
    const startedAtSec = Math.floor(Date.now() / 1000);
    this.db
      .query(
        "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, trigger_data, status, started_at) VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
      )
      .run(row.id, row.pipeline_id, row.trigger_type, row.trigger_data, startedAtSec);
  }
  finalizeExecution(id: string, status: string, errorMessage?: string): void {
    const endedAtSec = Math.floor(Date.now() / 1000);
    this.db
      .query("UPDATE pipeline_executions SET status = ?2, ended_at = ?3, error = ?4 WHERE id = ?1")
      .run(id, status, endedAtSec, errorMessage ?? null);
  }
  getExecution(id: string): ExecutionRow | null {
    const r = this.db
      .query<ExecutionDbRow, [string]>(`${EXECUTION_SELECT} WHERE e.id = ?1`)
      .get(id);
    return r ? mapExecutionRow(r) : null;
  }
  listExecutions(opts: {
    pipelineId?: string;
    status?: string;
    limit: number;
    offset?: number;
  }): ExecutionRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.pipelineId) {
      params.push(opts.pipelineId);
      where.push(`e.pipeline_id = ?${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`e.status = ?${params.length}`);
    }
    const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    // started_at has second resolution, so ties are common; rowid breaks them
    // deterministically so OFFSET pagination neither skips nor repeats rows.
    const sql = `${EXECUTION_SELECT}${whereSql} ORDER BY e.started_at DESC, e.rowid DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
    params.push(opts.limit, opts.offset ?? 0);
    const rows = this.db
      .query<ExecutionDbRow, (string | number)[]>(sql)
      .all(...params);
    return rows.map(mapExecutionRow);
  }
  insertExecutionLog(row: {
    execution_id: string;
    node_id: string | null;
    level: string;
    message: string;
    timestamp: string;
  }): void {
    const timestampSec = Math.floor(Date.parse(row.timestamp) / 1000);
    this.db
      .query(
        "INSERT INTO execution_logs (execution_id, node_id, level, message, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(row.execution_id, row.node_id, row.level, row.message, timestampSec);
  }
  listExecutionLogs(executionId: string): ExecutionLogRow[] {
    type Row = {
      id: number;
      execution_id: string;
      node_id: string | null;
      level: string;
      message: string;
      timestamp: number;
    };
    const rows = this.db
      .query<Row, [string]>(
        "SELECT id, execution_id, node_id, level, message, timestamp FROM execution_logs WHERE execution_id = ?1 ORDER BY id ASC",
      )
      .all(executionId);
    return rows.map((r) => ({
      id: r.id,
      execution_id: r.execution_id,
      node_id: r.node_id,
      level: r.level,
      message: r.message,
      timestamp: new Date(r.timestamp * 1000).toISOString(),
    }));
  }
}
