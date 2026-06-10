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

  getExecution(id: string): ExecutionRow | null | Promise<ExecutionRow | null>;
  listExecutions(opts: {
    pipelineId?: string;
    limit: number;
  }): ExecutionRow[] | Promise<ExecutionRow[]>;
  insertExecutionLog(row: {
    execution_id: string;
    node_id: string | null;
    level: string;
    message: string;
    /** ISO-8601 event time (from the executor event, not the write time). */
    timestamp: string;
  }): void | Promise<void>;
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

/** Project an executor event onto an `execution_logs` row. */
function logRowForEvent(event: NodeExecutionEvent): {
  node_id: string | null;
  level: string;
  message: string;
} {
  switch (event.type) {
    case "execution_started":
      return {
        node_id: null,
        level: "info",
        message: `Execution started for pipeline '${event.pipelineName}'`,
      };
    case "node_started":
      return {
        node_id: event.nodeId,
        level: "info",
        message: `Node '${event.nodeName}' started (iteration ${event.iteration})`,
      };
    case "node_completed":
      return {
        node_id: event.nodeId,
        level: "info",
        message: `Node '${event.nodeName}' completed`,
      };
    case "node_failed":
      return {
        node_id: event.nodeId,
        level: "error",
        message: `Node '${event.nodeName}' failed: ${event.error}`,
      };
    case "execution_completed":
      return {
        node_id: null,
        level: event.status === "completed" ? "info" : "error",
        message: event.errorMessage
          ? `Execution ${event.status}: ${event.errorMessage}`
          : `Execution ${event.status}`,
      };
  }
}

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
        try {
          await ctx.db.insertExecutionLog({
            execution_id: executionId,
            timestamp: event.timestamp,
            ...logRowForEvent(event),
          });
        } catch (logErr) {
          // A failed log write must not abort the execution itself.
          console.error(
            `[pipeline] failed to persist execution log for ${executionId}:`,
            logErr,
          );
        }
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

export interface ExecutionDetailResult extends ExecutionRow {
  /** Per-node executions are not recorded yet; kept for wire compatibility
   *  with the macOS `ExecutionDetail` Codable shape. */
  node_executions: never[];
  logs: ExecutionLogRow[];
}

const executionDetail: Handler<
  { execution_id: string },
  ExecutionDetailResult
> = async (params, ctx) => {
  const row = await ctx.db.getExecution(params.execution_id);
  if (!row) {
    throw new Error(`Execution with id '${params.execution_id}' not found`);
  }
  const logs = await ctx.db.listExecutionLogs(params.execution_id);
  return { ...row, node_executions: [], logs };
};

// ---------------------------------------------------------------------------
// Module-level context injection
// ---------------------------------------------------------------------------
//
// The dispatcher invokes handlers as `(params)` only, so handlers that need
// a `CommandContext` resolve it from a singleton set at startup via
// `configurePipelineCommands(ctx)`. Tests can call this to inject mocks.

let currentContext: CommandContext | null = null;

export function configurePipelineCommands(ctx: CommandContext): void {
  currentContext = ctx;
}

function requireContext(): CommandContext {
  if (!currentContext) {
    throw new Error(
      "pipeline.commands not configured: call configurePipelineCommands(ctx) at startup",
    );
  }
  return currentContext;
}

// ---------------------------------------------------------------------------
// Default export: the RPC handler map
// ---------------------------------------------------------------------------

const handlers = {
  "pipeline.list": (params: void) => pipelineList(params, requireContext()),
  "pipeline.get": (params: { id: string }) => pipelineGet(params, requireContext()),
  "pipeline.save": (params: {
    id?: string;
    name: string;
    description?: string | null;
    yaml_content: string;
    max_loop_count?: number;
    is_active?: boolean;
  }) => pipelineSave(params, requireContext()),
  "pipeline.delete": (params: { id: string }) =>
    pipelineDelete(params, requireContext()),
  "pipeline.execute": (params: {
    id: string;
    trigger_type?: string;
    trigger_data?: string | null;
  }) => pipelineExecute(params, requireContext()),
  "execution.history": (params: { pipeline_id?: string; limit?: number }) =>
    executionHistory(params, requireContext()),
  "execution.logs": (params: { execution_id: string }) =>
    executionLogs(params, requireContext()),
  "execution.detail": (params: { execution_id: string }) =>
    executionDetail(params, requireContext()),
} as const;

export type PipelineCommandMap = typeof handlers;
export default handlers;
