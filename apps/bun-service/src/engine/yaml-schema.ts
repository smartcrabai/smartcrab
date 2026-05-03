/**
 * TypeScript port of `crates/smartcrab-app/src-tauri/src/engine/yaml_schema.rs`.
 *
 * Discriminated unions and type tags follow the original serde encodings:
 * - `NodeAction` / `MatchCondition` use `{ type: "...", ...fields }` (serde tag).
 * - `NextTarget` is untagged (`string | string[]`).
 * - Field names use `snake_case` to match YAML/JSON wire format.
 */

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
