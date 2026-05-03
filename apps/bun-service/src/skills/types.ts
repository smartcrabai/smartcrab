/**
 * Shared types for the skills subsystem.
 *
 * Ported from `crates/smartcrab-app/src-tauri/src/commands/skills.rs`
 * (`SkillInfo`, `SkillInvocationResult`).
 */

/**
 * Information about a generated or loaded skill.
 *
 * `file_path` may be empty for in-memory / DB-only skills with `body`.
 */
export interface SkillInfo {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  skill_type: string;
  pipeline_id: string | null;
  created_at: string;
  updated_at: string;
  /** Optional inline body. Preferred over reading `file_path` when present. */
  body?: string;
}

/** Input for creating a new skill via `skill.create`. */
export interface SkillCreateInput {
  name: string;
  description?: string | null;
  skill_type?: string;
  pipeline_id?: string | null;
  /** Markdown body (optional). When omitted, `loader` may fill it later. */
  body?: string;
  /** Optional file path; if omitted the registry creates a virtual record. */
  file_path?: string;
}

/** Result of invoking a skill against an LLM. */
export interface SkillInvocationResult {
  skill_id: string;
  skill_name: string;
  output: string;
}

/**
 * Minimal LLM adapter interface used by the skills subsystem.
 *
 * Mirrors the `LlmAdapter::execute_prompt` shape from the Rust codebase but
 * keeps the surface narrow so any concrete adapter (Claude, Kimi, Copilot,
 * mock) can satisfy it.
 */
export interface LlmAdapter {
  execute_prompt(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  prompt: string;
  timeout_secs?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface LlmResponse {
  content: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Trace of a single execution step that auto-gen learns from.
 *
 * Inspired by hermes-agent's "skill from trajectory" loop. Each entry is one
 * observation: an action taken plus its outcome. Auto-gen looks for repeated
 * patterns and asks the LLM to generalize them into a reusable skill.
 */
export interface ExecutionTrace {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Free-form action label, e.g. `"chat.send"`, `"pipeline.execute"`. */
  action: string;
  /** Arbitrary structured input that was passed to the action. */
  input?: unknown;
  /** Arbitrary structured output / outcome. */
  output?: unknown;
  /** Optional human-readable note. */
  note?: string;
}
