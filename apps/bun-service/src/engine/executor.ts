/**
 * TypeScript port of the `run_pipeline_async` scheduler from
 * `crates/smartcrab-app/src-tauri/src/commands/execution.rs`.
 *
 * Builds an execution graph from a `ResolvedPipeline`, then schedules nodes
 * topologically with parallel sibling execution. Yields events as an
 * `AsyncIterable<NodeExecutionEvent>` so callers can stream progress (e.g.
 * over a WebSocket).
 */

import { LoopGuard } from "./loop-guard.ts";
import type { ExecutorDeps } from "./dynamic-node.ts";
import { executeNodeAction } from "./dynamic-node.ts";
import type {
  Condition,
  NodeDefinition,
  PipelineDefinition,
  ResolvedPipeline,
} from "./yaml-schema.ts";

const DEFAULT_MAX_LOOP = 100;

export type NodeExecutionEvent =
  | {
      type: "execution_started";
      executionId: string;
      pipelineName: string;
      data?: unknown;
      timestamp: string;
    }
  | {
      type: "node_started";
      executionId: string;
      nodeId: string;
      nodeName: string;
      data: unknown;
      iteration: number;
      timestamp: string;
    }
  | {
      type: "node_completed";
      executionId: string;
      nodeId: string;
      nodeName: string;
      data: unknown;
      timestamp: string;
    }
  | {
      type: "node_failed";
      executionId: string;
      nodeId: string;
      nodeName: string;
      error: string;
      timestamp: string;
    }
  | {
      type: "execution_completed";
      executionId: string;
      status: "completed" | "failed" | "cancelled";
      errorMessage?: string;
      timestamp: string;
    };

interface ExecutionGraph {
  nodes: Map<string, NodeDefinition>;
  successors: Map<string, string[]>;
  predecessorCounts: Map<string, number>;
  compiledRegexes: Map<string, RegExp>;
}

function buildGraph(resolved: ResolvedPipeline): ExecutionGraph {
  const nodes = new Map<string, NodeDefinition>();
  const successors = new Map<string, string[]>();
  const predecessorCounts = new Map<string, number>();
  const compiledRegexes = new Map<string, RegExp>();

  for (const node of resolved.definition.nodes) {
    nodes.set(node.id, node);
    if (!predecessorCounts.has(node.id)) predecessorCounts.set(node.id, 0);

    if (node.next !== undefined) {
      const targets =
        typeof node.next === "string" ? [node.next] : [...node.next];
      for (const t of targets) {
        predecessorCounts.set(t, (predecessorCounts.get(t) ?? 0) + 1);
      }
      successors.set(node.id, targets);
    }

    if (node.conditions) {
      for (const c of node.conditions) {
        if (c.match.type === "regex" && !compiledRegexes.has(c.match.pattern)) {
          try {
            compiledRegexes.set(c.match.pattern, new RegExp(c.match.pattern));
          } catch {
            // ignore invalid regex; rule won't match
          }
        }
      }
    }
  }

  return { nodes, successors, predecessorCounts, compiledRegexes };
}

function outputToString(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function evaluateConditions(
  conditions: Condition[],
  output: unknown,
  graph: ExecutionGraph,
): string[] {
  const matched: string[] = [];
  for (const c of conditions) {
    let matches = false;
    switch (c.match.type) {
      case "status_code": {
        const code =
          output && typeof output === "object" && "status_code" in output
            ? (output as { status_code?: unknown }).status_code
            : undefined;
        matches =
          typeof code === "number" && c.match.codes.includes(code);
        break;
      }
      case "regex": {
        const re = graph.compiledRegexes.get(c.match.pattern);
        matches = re !== undefined && re.test(outputToString(output));
        break;
      }
      case "json_path": {
        if (output && typeof output === "object" && c.match.path in output) {
          matches =
            JSON.stringify((output as Record<string, unknown>)[c.match.path]) ===
            JSON.stringify(c.match.expected);
        }
        break;
      }
      case "exit_when": {
        matches = outputToString(output).includes(c.match.pattern);
        break;
      }
    }
    if (matches) matched.push(c.next);
  }
  return matched;
}

function normalizeFanIn(upstream: Map<string, unknown>): unknown {
  if (upstream.size === 0) return null;
  if (upstream.size === 1) {
    return upstream.values().next().value;
  }
  return { upstream: Object.fromEntries(upstream) };
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface ExecutePipelineOptions {
  executionId?: string;
  isCancelled?: () => boolean | Promise<boolean>;
}

/**
 * Execute a parsed pipeline definition and stream node-execution events.
 *
 * Sibling nodes run in parallel; fan-in nodes wait for all unconditional
 * predecessors to complete. Conditional successors are routed at runtime
 * based on the upstream node's output.
 */
export async function* executePipeline(
  def: PipelineDefinition | ResolvedPipeline,
  input: unknown,
  deps: ExecutorDeps,
  options: ExecutePipelineOptions = {},
): AsyncIterable<NodeExecutionEvent> {
  const resolved: ResolvedPipeline =
    "definition" in def
      ? def
      : { definition: def, nodeTypes: new Map() };
  const graph = buildGraph(resolved);
  const executionId = options.executionId ?? cryptoRandomId();
  const maxLoops = resolved.definition.max_loop_count ?? DEFAULT_MAX_LOOP;
  const loopGuard = new LoopGuard(maxLoops);
  const pendingPreds = new Map(graph.predecessorCounts);
  const upstreamOutputs = new Map<string, Map<string, unknown>>();

  yield {
    type: "execution_started",
    executionId,
    pipelineName: resolved.definition.name,
    data: input,
    timestamp: nowIso(),
  };

  const ready: string[] = [];
  for (const id of graph.nodes.keys()) {
    if ((graph.predecessorCounts.get(id) ?? 0) === 0) ready.push(id);
  }
  ready.sort();

  // Each task resolves to a TaskResult tagged with its own promise handle so
  // we can remove the entry from `inflight` by identity after `Promise.race`
  // returns the value (not the promise).
  type TaskResult = {
    nodeId: string;
    nodeName: string;
    output?: unknown;
    error?: string;
    handle: Promise<TaskResult>;
  };
  const inflight = new Set<Promise<TaskResult>>();
  let finalStatus: "completed" | "failed" | "cancelled" = "completed";
  let errorMessage: string | undefined;

  const spawn = (nodeId: string, nodeName: string, nodeInput: unknown): void => {
    const node = graph.nodes.get(nodeId);
    if (!node) return;
    let handle!: Promise<TaskResult>;
    handle = executeNodeAction(node, nodeInput, deps).then(
      (output): TaskResult => ({ nodeId, nodeName, output, handle }),
      (e: unknown): TaskResult => ({
        nodeId,
        nodeName,
        error: e instanceof Error ? e.message : String(e),
        handle,
      }),
    );
    inflight.add(handle);
  };

  const drain = async (): Promise<void> => {
    while (inflight.size > 0) {
      const settled = await Promise.race(inflight);
      inflight.delete(settled.handle);
    }
  };

  while (ready.length > 0 || inflight.size > 0) {
    if (options.isCancelled && (await options.isCancelled())) {
      finalStatus = "cancelled";
      errorMessage = "execution was cancelled";
      await drain();
      break;
    }

    while (ready.length > 0) {
      const nodeId = ready.shift()!;
      const node = graph.nodes.get(nodeId);
      if (!node) continue;

      let iteration: number;
      try {
        iteration = loopGuard.checkAndIncrement(nodeId);
      } catch (e) {
        finalStatus = "failed";
        errorMessage = e instanceof Error ? e.message : String(e);
        break;
      }

      const upstream = upstreamOutputs.get(nodeId);
      const nodeInput = upstream ? normalizeFanIn(upstream) : input;

      yield {
        type: "node_started",
        executionId,
        nodeId,
        nodeName: node.name,
        data: nodeInput,
        iteration,
        timestamp: nowIso(),
      };

      spawn(nodeId, node.name, nodeInput);
    }

    if (finalStatus !== "completed") {
      await drain();
      break;
    }

    if (inflight.size === 0) break;

    const settled = await Promise.race(inflight);
    inflight.delete(settled.handle);

    if (settled.error !== undefined) {
      finalStatus = "failed";
      errorMessage = settled.error;
      yield {
        type: "node_failed",
        executionId,
        nodeId: settled.nodeId,
        nodeName: settled.nodeName,
        error: settled.error,
        timestamp: nowIso(),
      };
      await drain();
      break;
    }

    yield {
      type: "node_completed",
      executionId,
      nodeId: settled.nodeId,
      nodeName: settled.nodeName,
      data: settled.output,
      timestamp: nowIso(),
    };

    const targets: string[] = [...(graph.successors.get(settled.nodeId) ?? [])];
    const node = graph.nodes.get(settled.nodeId);
    if (node?.conditions && node.conditions.length > 0) {
      targets.push(...evaluateConditions(node.conditions, settled.output, graph));
    }
    for (const t of targets) {
      const map = upstreamOutputs.get(t) ?? new Map<string, unknown>();
      map.set(settled.nodeId, settled.output);
      upstreamOutputs.set(t, map);
      const remaining = (pendingPreds.get(t) ?? 0) - 1;
      pendingPreds.set(t, Math.max(0, remaining));
      if (remaining <= 0) ready.push(t);
    }
  }

  yield {
    type: "execution_completed",
    executionId,
    status: finalStatus,
    errorMessage,
    timestamp: nowIso(),
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
