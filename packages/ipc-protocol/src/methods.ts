/**
 * Typed JSON-RPC method map.
 *
 * Each method has a `params` and `result` shape. Domain types (Pipeline,
 * Execution, CronJob, ChatMessage, Skill, MemoryEntry) are derived from the
 * Rust schema in `crates/smartcrab-app/src-tauri/src/db/schema.rs`.
 */

// ─── Domain types ─────────────────────────────────────────────────────────

/** ISO-8601 timestamp string. */
export type IsoDateTime = string;

/** Pipeline definition (mirrors `pipelines` SQLite table). */
export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  yamlContent: string;
  maxLoopCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isActive: boolean;
}

/** Pipeline trigger source. */
export type ExecutionTrigger = "manual" | "cron" | "chat" | "api";

/** Pipeline execution status. */
export type ExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Pipeline execution record (mirrors `pipeline_executions` table). */
export interface Execution {
  id: string;
  pipelineId: string;
  triggerType: ExecutionTrigger;
  triggerData: string | null;
  status: ExecutionStatus;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  errorMessage: string | null;
}

/** Per-node execution record (mirrors `node_executions` table). */
export interface NodeExecution {
  id: string;
  executionId: string;
  nodeId: string;
  nodeName: string;
  iteration: number;
  status: ExecutionStatus;
  inputData: string | null;
  outputData: string | null;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  errorMessage: string | null;
}

/** Log severity. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Execution log entry (mirrors `execution_logs` table). */
export interface ExecutionLog {
  id: number;
  executionId: string;
  nodeId: string | null;
  level: LogLevel;
  message: string;
  timestamp: IsoDateTime;
}

/** Cron job (mirrors `cron_jobs` table). */
export interface CronJob {
  id: string;
  pipelineId: string;
  schedule: string;
  isActive: boolean;
  lastRunAt: IsoDateTime | null;
  nextRunAt: IsoDateTime | null;
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

/** Chat message (mirrors Rust `ChatMessage`). */
export interface ChatMessage {
  channelId: string;
  content: string;
  author: string | null;
  metadata: Record<string, unknown> | null;
}

/** Skill type. */
export type SkillType = "pipeline" | "script" | "builtin";

/** Skill (mirrors `skills` table). */
export interface Skill {
  id: string;
  name: string;
  description: string | null;
  filePath: string;
  skillType: SkillType;
  pipelineId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Memory entry. */
export interface MemoryEntry {
  id: string;
  content: string;
  embedding: number[] | null;
  tags: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Settings record. */
export interface Settings {
  activeChatAdapterId: string | null;
  activeLlmAdapterId: string | null;
  /** Free-form preferences. */
  preferences: Record<string, unknown>;
}

// ─── Method param/result map ──────────────────────────────────────────────

export interface RpcMethods {
  // ── system ────────────────────────────────────────────────────────────
  "system.ping": {
    params: { message?: string };
    result: { pong: true; receivedAt: IsoDateTime };
  };

  // ── pipelines ─────────────────────────────────────────────────────────
  "pipeline.list": {
    params: { activeOnly?: boolean };
    result: { pipelines: Pipeline[] };
  };
  "pipeline.get": {
    params: { id: string };
    result: { pipeline: Pipeline };
  };
  "pipeline.save": {
    params: {
      id?: string;
      name: string;
      description?: string | null;
      yamlContent: string;
      maxLoopCount?: number;
      isActive?: boolean;
    };
    result: { pipeline: Pipeline };
  };
  "pipeline.execute": {
    params: {
      id: string;
      triggerType?: ExecutionTrigger;
      triggerData?: string | null;
    };
    result: { executionId: string };
  };
  "pipeline.delete": {
    params: { id: string };
    result: { deleted: true };
  };

  // ── execution ─────────────────────────────────────────────────────────
  "execution.history": {
    params: {
      pipelineId?: string;
      status?: ExecutionStatus;
      limit?: number;
      offset?: number;
    };
    result: { executions: Execution[] };
  };
  "execution.logs": {
    params: {
      executionId: string;
      nodeId?: string;
      level?: LogLevel;
      limit?: number;
    };
    result: { logs: ExecutionLog[] };
  };

  // ── cron ──────────────────────────────────────────────────────────────
  "cron.list": {
    params: Record<string, never>;
    result: { jobs: CronJob[] };
  };
  "cron.create": {
    params: { pipelineId: string; schedule: string; isActive?: boolean };
    result: { job: CronJob };
  };
  "cron.update": {
    params: {
      id: string;
      schedule?: string;
      isActive?: boolean;
    };
    result: { job: CronJob };
  };
  "cron.delete": {
    params: { id: string };
    result: { deleted: true };
  };
  "cron.run-now": {
    params: { id: string };
    result: { executionId: string };
  };

  // ── chat ──────────────────────────────────────────────────────────────
  "chat.send": {
    params: { adapterId: string; channelId: string; content: string };
    result: { sent: true };
  };
  "chat.start": {
    params: { adapterId: string };
    result: { running: true };
  };
  "chat.stop": {
    params: { adapterId: string };
    result: { running: false };
  };
  "chat.status": {
    params: { adapterId?: string };
    result: { adapters: Array<{ id: string; running: boolean }> };
  };

  // ── skill ─────────────────────────────────────────────────────────────
  "skill.list": {
    params: { type?: SkillType };
    result: { skills: Skill[] };
  };
  "skill.invoke": {
    params: { id: string; input?: Record<string, unknown> };
    result: { output: unknown };
  };
  "skill.create": {
    params: {
      name: string;
      description?: string | null;
      filePath: string;
      skillType: SkillType;
      pipelineId?: string | null;
    };
    result: { skill: Skill };
  };
  "skill.delete": {
    params: { id: string };
    result: { deleted: true };
  };

  // ── memory ────────────────────────────────────────────────────────────
  "memory.search": {
    params: { query: string; limit?: number; tags?: string[] };
    result: { entries: MemoryEntry[] };
  };
  "memory.add": {
    params: { content: string; tags?: string[] };
    result: { entry: MemoryEntry };
  };
  "memory.summarize": {
    params: { entryIds: string[]; instruction?: string };
    result: { summary: string };
  };

  // ── settings ──────────────────────────────────────────────────────────
  "settings.get": {
    params: Record<string, never>;
    result: { settings: Settings };
  };
  "settings.save": {
    params: { settings: Partial<Settings> };
    result: { settings: Settings };
  };
}

/** All known method names (compile-time). */
export type RpcMethodName = keyof RpcMethods;

/** Params for a given method. */
export type RpcParams<M extends RpcMethodName> = RpcMethods[M]["params"];

/** Result for a given method. */
export type RpcResult<M extends RpcMethodName> = RpcMethods[M]["result"];

/** Runtime list of every method name (kept in sync with `RpcMethods`). */
export const RPC_METHOD_NAMES: readonly RpcMethodName[] = [
  "system.ping",
  "pipeline.list",
  "pipeline.get",
  "pipeline.save",
  "pipeline.execute",
  "pipeline.delete",
  "execution.history",
  "execution.logs",
  "cron.list",
  "cron.create",
  "cron.update",
  "cron.delete",
  "cron.run-now",
  "chat.send",
  "chat.start",
  "chat.stop",
  "chat.status",
  "skill.list",
  "skill.invoke",
  "skill.create",
  "skill.delete",
  "memory.search",
  "memory.add",
  "memory.summarize",
  "settings.get",
  "settings.save",
] as const;
