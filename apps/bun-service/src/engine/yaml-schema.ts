/**
 * TypeScript port of `crates/smartcrab-app/src-tauri/src/engine/yaml_schema.rs`.
 *
 * Discriminated unions and type tags follow the original serde encodings:
 * - `NodeAction` / `MatchCondition` use `{ type: "...", ...fields }` (serde tag).
 * - `NextTarget` is untagged (`string | string[]`).
 * - Field names use `snake_case` to match YAML/JSON wire format.
 *
 * The Zod schemas at the bottom mirror these types and are used by
 * `pipeline.author` to coerce LLM tool-emission output into a validated
 * `PipelineDefinition` before serializing to YAML.
 */

import { z } from "zod";

export type TriggerType = "discord" | "cron";

export interface TriggerConfig {
  type: TriggerType;
  triggers?: string[];
  schedule?: string;
}

export type NextTarget = string | string[];

export type MatchCondition =
  | { type: "regex"; pattern: string }
  | { type: "status_code"; codes: number[] }
  | { type: "json_path"; path: string; expected: unknown }
  | { type: "exit_when"; pattern: string };

export interface Condition {
  match: MatchCondition;
  next: string;
}

export type NodeAction =
  | {
      type: "llm_call";
      provider: string;
      prompt: string;
      timeout_secs: number;
    }
  | {
      type: "http_request";
      method: string;
      url_template: string;
      headers?: Record<string, string>;
      body_template?: string;
    }
  | {
      type: "shell_command";
      command_template: string;
      working_dir?: string;
      timeout_secs: number;
    }
  | {
      type: "chat_send";
      adapter: string;
      channel_id?: string;
      content_template: string;
    };

export interface NodeDefinition {
  id: string;
  name: string;
  action?: NodeAction;
  next?: NextTarget;
  conditions?: Condition[];
}

export interface PipelineDefinition {
  name: string;
  description?: string;
  version: string;
  trigger: TriggerConfig;
  max_loop_count?: number;
  nodes: NodeDefinition[];
}

/** Resolved kind of a node based on graph topology. */
export type NodeKind = "Input" | "Hidden" | "Output";

export interface ResolvedPipeline {
  definition: PipelineDefinition;
  nodeTypes: Map<string, NodeKind>;
}

// ---------------------------------------------------------------------------
// Zod schemas — used by `pipeline.author` for LLM tool-emission validation.
// Kept manually in sync with the TypeScript types above; `pipeline-roundtrip`
// tests verify a few well-formed pipelines parse identically through both.
// ---------------------------------------------------------------------------

export const triggerConfigSchema = z.object({
  type: z.enum(["discord", "cron"]),
  triggers: z.array(z.string()).optional(),
  schedule: z.string().optional(),
});

export const matchConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("regex"), pattern: z.string() }),
  z.object({ type: z.literal("status_code"), codes: z.array(z.number()) }),
  z.object({ type: z.literal("json_path"), path: z.string(), expected: z.unknown() }),
  z.object({ type: z.literal("exit_when"), pattern: z.string() }),
]);

export const conditionSchema = z.object({
  match: matchConditionSchema,
  next: z.string(),
});

export const nodeActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("llm_call"),
    provider: z.string(),
    prompt: z.string(),
    timeout_secs: z.number(),
  }),
  z.object({
    type: z.literal("http_request"),
    method: z.string(),
    url_template: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    body_template: z.string().optional(),
  }),
  z.object({
    type: z.literal("shell_command"),
    command_template: z.string(),
    working_dir: z.string().optional(),
    timeout_secs: z.number(),
  }),
  z.object({
    type: z.literal("chat_send"),
    adapter: z.string(),
    channel_id: z.string().optional(),
    content_template: z.string(),
  }),
]);

export const nextTargetSchema = z.union([z.string(), z.array(z.string())]);

export const nodeDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: nodeActionSchema.optional(),
  next: nextTargetSchema.optional(),
  conditions: z.array(conditionSchema).optional(),
});

export const pipelineDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string(),
  trigger: triggerConfigSchema,
  max_loop_count: z.number().optional(),
  nodes: z.array(nodeDefinitionSchema).min(1),
});
