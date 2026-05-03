/**
 * RPC command handlers for pipeline CRUD and execution.
 *
 * Default-exports an object whose keys are RPC method names ("pipeline.list",
 * "pipeline.execute", etc.). Each handler takes a typed `params` argument and
 * a `ctx` containing the database and executor dependencies.
 *
 * Mirrors `crates/smartcrab-app/src-tauri/src/commands/pipeline.rs` and
 * `commands/execution.rs`. Database calls are stubbed via the `Database`
 * interface so the module is testable without `bun:sqlite` being available.
 */

import { parsePipeline } from "../engine/yaml-parser.ts";
import { executePipeline } from "../engine/executor.ts";
import type { ExecutorDeps } from "../engine/dynamic-node.ts";
import type { NodeExecutionEvent } from "../engine/executor.ts";

// ---------------------------------------------------------------------------
// Database abstraction (implemented elsewhere with bun:sqlite in production)
// ---------------------------------------------------------------------------

export interface PipelineRow {
  id: string;
  name: string;
  description: string | null;
  yaml_content: string;
  max_loop_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExecutionRow {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  trigger_type: string;
  trigger_data: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface ExecutionLogRow {
  id: number;
  execution_id: string;
  node_id: string | null;
  level: string;
  message: string;
  timestamp: string;
}

export interface PipelineDatabase {
  listPipelines(): PipelineRow[] | Promise<PipelineRow[]>;
  getPipeline(id: string): PipelineRow | null | Promise<PipelineRow | null>;
  savePipeline(input: {
    id?: string;
    name: string;
    description?: string;
    yaml_content: string;
  }): PipelineRow | Promise<PipelineRow>;
  deletePipeline(id: string): void | Promise<void>;

  insertExecution(row: {
    id: string;
    pipeline_id: string;
    trigger_type: string;
    trigger_data: string | null;
  }): void | Promise<void>;
  finalizeExecution(
    id: string,
    status: string,
    errorMessage?: string,
  ): void | Promise<void>;

  listExecutions(opts: {
    pipelineId?: string;
    limit: number;
  }): ExecutionRow[] | Promise<ExecutionRow[]>;
  listExecutionLogs(
    executionId: string,
  ): ExecutionLogRow[] | Promise<ExecutionLogRow[]>;
}

// ---------------------------------------------------------------------------
// Context passed to every handler
// ---------------------------------------------------------------------------

export interface CommandContext {
  db: PipelineDatabase;
  deps: ExecutorDeps;
  /** Optional sink for streamed execution events (WebSocket/SSE). */
  emit?: (event: NodeExecutionEvent) => void;
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

type Handler<P, R> = (params: P, ctx: CommandContext) => Promise<R> | R;

const pipelineList: Handler<void, PipelineRow[]> = async (_params, ctx) =>
  await ctx.db.listPipelines();

const pipelineGet: Handler<{ id: string }, PipelineRow> = async (
  params,
  ctx,
) => {
  const row = await ctx.db.getPipeline(params.id);
  if (!row) throw new Error(`Pipeline with id '${params.id}' not found`);
  return row;
};

const pipelineSave: Handler<
  { id?: string; name: string; description?: string; yaml_content: string },
  PipelineRow
> = async (params, ctx) => {
  // Validate YAML before persisting.
  parsePipeline(params.yaml_content);
  return await ctx.db.savePipeline(params);
};

const pipelineDelete: Handler<{ id: string }, { ok: true }> = async (
  params,
  ctx,
) => {
  await ctx.db.deletePipeline(params.id);
  return { ok: true };
};

const pipelineExecute: Handler<
  { id: string; trigger_data?: unknown },
  { execution_id: string }
> = async (params, ctx) => {
  const pipeline = await ctx.db.getPipeline(params.id);
  if (!pipeline) throw new Error(`Pipeline with id '${params.id}' not found`);
  const resolved = parsePipeline(pipeline.yaml_content);

  const executionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `exec-${Date.now()}`;

  await ctx.db.insertExecution({
    id: executionId,
    pipeline_id: params.id,
    trigger_type: "manual",
    trigger_data:
      params.trigger_data === undefined
        ? null
        : JSON.stringify(params.trigger_data),
  });

  // Run in the background; events are pushed through `ctx.emit` when set.
  void (async () => {
    let finalStatus: "completed" | "failed" | "cancelled" = "completed";
    let errorMessage: string | undefined;
    try {
      for await (const event of executePipeline(
        resolved,
        params.trigger_data,
        ctx.deps,
        { executionId },
      )) {
        ctx.emit?.(event);
        if (event.type === "execution_completed") {
          finalStatus = event.status;
          errorMessage = event.errorMessage;
        }
      }
    } catch (e) {
      finalStatus = "failed";
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      await ctx.db.finalizeExecution(executionId, finalStatus, errorMessage);
    }
  })();

  return { execution_id: executionId };
};

const executionHistory: Handler<
  { pipeline_id?: string; limit?: number },
  ExecutionRow[]
> = async (params, ctx) =>
  await ctx.db.listExecutions({
    pipelineId: params.pipeline_id,
    limit: params.limit ?? 50,
  });

const executionLogs: Handler<
  { execution_id: string },
  ExecutionLogRow[]
> = async (params, ctx) => await ctx.db.listExecutionLogs(params.execution_id);

// ---------------------------------------------------------------------------
// Default export: the RPC handler map
// ---------------------------------------------------------------------------

const handlers = {
  "pipeline.list": pipelineList,
  "pipeline.get": pipelineGet,
  "pipeline.save": pipelineSave,
  "pipeline.delete": pipelineDelete,
  "pipeline.execute": pipelineExecute,
  "execution.history": executionHistory,
  "execution.logs": executionLogs,
} as const;

export type PipelineCommandMap = typeof handlers;
export default handlers;
