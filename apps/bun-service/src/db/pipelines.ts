import type { Database } from "bun:sqlite";

import type {
  ExecutionLogRow,
  ExecutionRow,
  PipelineDatabase,
  PipelineRow,
} from "../commands/pipeline.commands.ts";

function notImplemented(method: string): Error {
  return new Error(`PipelineDatabase.${method} is not yet wired (PR-1 scope: pipeline.list only)`);
}

/** Adapter from raw `bun:sqlite` rows to the PipelineDatabase interface
 *  used by pipeline.commands. Only `listPipelines` is fully implemented;
 *  other methods will be filled in by subsequent PRs as they are wired. */
export class SqlitePipelineDatabase implements PipelineDatabase {
  constructor(private readonly db: Database) {}

  listPipelines(): PipelineRow[] {
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
        },
        []
      >(
        "SELECT id, name, description, yaml_content, max_loop_count, enabled, created_at, updated_at FROM pipelines ORDER BY name ASC",
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
    }));
  }

  getPipeline(_id: string): PipelineRow | null {
    throw notImplemented("getPipeline");
  }
  savePipeline(_input: {
    id?: string;
    name: string;
    description?: string | null;
    yaml_content: string;
    max_loop_count?: number;
    is_active?: boolean;
  }): PipelineRow {
    throw notImplemented("savePipeline");
  }
  deletePipeline(_id: string): void {
    throw notImplemented("deletePipeline");
  }
  insertExecution(_row: {
    id: string;
    pipeline_id: string;
    trigger_type: string;
    trigger_data: string | null;
    status: string;
    started_at: string;
  }): void {
    throw notImplemented("insertExecution");
  }
  finalizeExecution(_id: string, _status: string, _errorMessage?: string): void {
    throw notImplemented("finalizeExecution");
  }
  listExecutions(opts: { pipelineId?: string; limit: number }): ExecutionRow[] {
    const sql = opts.pipelineId
      ? "SELECT e.id, e.pipeline_id, p.name AS pipeline_name, e.trigger_type, e.trigger_data, e.status, e.started_at, e.ended_at, e.error FROM pipeline_executions e JOIN pipelines p ON p.id = e.pipeline_id WHERE e.pipeline_id = ?1 ORDER BY e.started_at DESC LIMIT ?2"
      : "SELECT e.id, e.pipeline_id, p.name AS pipeline_name, e.trigger_type, e.trigger_data, e.status, e.started_at, e.ended_at, e.error FROM pipeline_executions e JOIN pipelines p ON p.id = e.pipeline_id ORDER BY e.started_at DESC LIMIT ?1";
    type Row = {
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
    const rows: Row[] = opts.pipelineId
      ? this.db.query<Row, [string, number]>(sql).all(opts.pipelineId, opts.limit)
      : this.db.query<Row, [number]>(sql).all(opts.limit);
    return rows.map((r) => ({
      id: r.id,
      pipeline_id: r.pipeline_id,
      pipeline_name: r.pipeline_name,
      trigger_type: r.trigger_type,
      trigger_data: r.trigger_data,
      status: r.status,
      started_at: new Date(r.started_at * 1000).toISOString(),
      completed_at: r.ended_at ? new Date(r.ended_at * 1000).toISOString() : null,
      error_message: r.error,
    }));
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
