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
  listExecutions(_opts: { pipelineId?: string; limit: number }): ExecutionRow[] {
    throw notImplemented("listExecutions");
  }
  listExecutionLogs(_executionId: string): ExecutionLogRow[] {
    throw notImplemented("listExecutionLogs");
  }
}
