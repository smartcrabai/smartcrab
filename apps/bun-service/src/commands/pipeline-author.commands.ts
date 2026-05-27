/**
 * RPC handler for natural-language pipeline authoring.
 *
 * Method:
 *   - `pipeline.author({ instruction, currentYaml? }) -> { yaml, explanation, model }`
 *
 * The LLM is asked to call a `submit_pipeline` tool whose Zod schema mirrors
 * `PipelineDefinition`. The tool handler captures the structured object,
 * which is then serialized to YAML server-side and returned to the caller.
 *
 * When no `currentYaml` is supplied, the LLM is asked to *create* a pipeline.
 * Otherwise the existing YAML is included verbatim in the prompt and the
 * LLM is asked to refine it according to the instruction. The Swift UI is
 * the only place that keeps a conversation log — server-side this command
 * is stateless.
 */

import type { Database } from "bun:sqlite";
import YAML from "yaml";
import { z } from "zod";

import type { RouteRequest } from "../router.ts";
import {
  pipelineDefinitionSchema,
  type PipelineDefinition,
} from "../engine/yaml-schema.ts";

export interface PipelineAuthorParams {
  instruction: string;
  /**
   * Existing YAML for refinement. Wire key is snake_case (`current_yaml`)
   * because the macOS client encodes with `.convertToSnakeCase`, matching the
   * rest of the RPC surface (`yaml_content`, `trigger_type`, …).
   */
  current_yaml?: string;
}

export interface PipelineAuthorResult {
  yaml: string;
  explanation: string;
  /**
   * The seher agent kind that produced the result
   * (`claude` | `copilot` | `pi` | `registry-fallback`) — not a model id.
   */
  kind: string;
}

interface PipelineAuthorContext {
  /** Looks up the user's configured LLM providers, e.g. for the system prompt. */
  listProviders(): Promise<string[]> | string[];
  /** Looks up registered chat adapters available as `chat_send` targets. */
  listChatAdapters(): Promise<string[]> | string[];
  /** Maximum outer retries (separate from inner tool-call retries). */
  maxOuterRetries?: number;
  /** Override to inject a mock router in tests. */
  route?: (req: RouteRequest) => Promise<{ text: string; kind: string }>;
}

let currentContext: PipelineAuthorContext | null = null;

export function configurePipelineAuthorCommands(ctx: PipelineAuthorContext): void {
  currentContext = ctx;
}

function requireContext(): PipelineAuthorContext {
  if (!currentContext) {
    throw new Error(
      "pipeline.author not configured: call configurePipelineAuthorCommands(ctx) at startup",
    );
  }
  return currentContext;
}

/**
 * Default DB-backed provider listing — looks at the same `seher_config`
 * blob the SwiftUI Settings tab writes, returning each provider's `id`.
 */
export function makeDbProviderLister(db: Database): () => string[] {
  return () => {
    const row = db
      .query<{ config_json: string }, []>(
        "SELECT config_json FROM seher_config WHERE id = 1",
      )
      .get();
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.config_json) as {
        providers?: Array<{ id?: unknown }>;
      };
      return (parsed.providers ?? [])
        .map((p) => (typeof p.id === "string" ? p.id : null))
        .filter((x): x is string => !!x);
    } catch {
      return [];
    }
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const FEW_SHOT_EXAMPLES = `Example 1 — Discord-triggered LLM summary
{
  "name": "daily-standup-summary",
  "description": "Summarize yesterday's Discord chatter when invoked.",
  "version": "1.0",
  "trigger": { "type": "discord", "triggers": ["summary"] },
  "nodes": [
    {
      "id": "summarize",
      "name": "Summarize",
      "action": {
        "type": "llm_call",
        "provider": "anthropic",
        "prompt": "Summarize the following Discord transcript: {{trigger.body}}",
        "timeout_secs": 30
      },
      "next": "reply"
    },
    {
      "id": "reply",
      "name": "Reply",
      "action": {
        "type": "chat_send",
        "adapter": "discord",
        "content_template": "{{summarize.output}}"
      }
    }
  ]
}

Example 2 — Cron-triggered HTTP poll
{
  "name": "hourly-status-poll",
  "version": "1.0",
  "trigger": { "type": "cron", "schedule": "0 * * * *" },
  "nodes": [
    {
      "id": "fetch",
      "name": "Fetch status",
      "action": {
        "type": "http_request",
        "method": "GET",
        "url_template": "https://status.example.com/json"
      }
    }
  ]
}`;

export function buildSystemPrompt(opts: {
  providers: string[];
  chatAdapters: string[];
}): string {
  const providers = opts.providers.length > 0 ? opts.providers.join(", ") : "(none configured)";
  const adapters = opts.chatAdapters.length > 0 ? opts.chatAdapters.join(", ") : "(none registered)";
  return `You author SmartCrab pipelines. SmartCrab pipelines are DAGs of nodes that run actions when triggered by Discord or cron.

When asked to create or refine a pipeline, you MUST call the \`submit_pipeline\` tool with a structured pipeline definition. Do not output YAML directly. Do not skip the tool call.

Schema summary (the tool's parameters are the canonical schema):
- name: short kebab-case identifier
- description: optional short summary
- version: typically "1.0"
- trigger: { type: "discord", triggers?: string[] } or { type: "cron", schedule: "<cron expr>" }
- max_loop_count: optional integer cap on loop iterations
- nodes: 1+ NodeDefinition. Each node has:
  - id, name
  - action (optional): one of llm_call | http_request | shell_command | chat_send
  - next: single node id, or array, or omitted for terminal nodes
  - conditions: optional branching with match (regex | status_code | json_path | exit_when)

Available LLM providers (use these exact ids for llm_call.provider): ${providers}.
Available chat adapters (use these exact ids for chat_send.adapter): ${adapters}.

Few-shot examples (JSON, not YAML — call the tool with the same structure):
${FEW_SHOT_EXAMPLES}

Before calling the tool, write a 1-2 sentence plain-text explanation of what you're building or changing so the user sees your reasoning.`;
}

function buildUserPrompt(params: PipelineAuthorParams): string {
  if (params.current_yaml && params.current_yaml.trim().length > 0) {
    return `Current pipeline (YAML):
\`\`\`yaml
${params.current_yaml.trim()}
\`\`\`

Refinement instruction:
${params.instruction}

Apply the instruction. Call submit_pipeline with the FULL updated pipeline (not a diff).`;
  }
  return `Create a new pipeline that satisfies this request:
${params.instruction}

Call submit_pipeline with the complete pipeline definition.`;
}

// ---------------------------------------------------------------------------
// Shared tool wiring (also used by chat-bubble.commands.ts)
// ---------------------------------------------------------------------------

/** Tool name the LLM calls to emit a structured pipeline. */
export const PIPELINE_TOOL_NAME = "submit_pipeline";

/**
 * Build the `submit_pipeline` SeherTool. The schema (`PipelineDefinition`) and
 * name are shared; callers supply the `description` and an `onSubmit` callback
 * that decides what to do with the validated pipeline (capture vs. persist).
 * `parameters.parse()` runs in router.ts before `handler`, so `pipeline` is
 * already structurally valid here.
 */
export function makePipelineSubmitTool(opts: {
  description: string;
  onSubmit: (pipeline: PipelineDefinition) => string | Promise<string>;
}) {
  return {
    name: PIPELINE_TOOL_NAME,
    description: opts.description,
    parameters: pipelineDefinitionSchema,
    handler: (input: z.infer<typeof pipelineDefinitionSchema>) =>
      opts.onSubmit(input as PipelineDefinition),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function pipelineAuthor(
  params: PipelineAuthorParams,
): Promise<PipelineAuthorResult> {
  if (!params || typeof params.instruction !== "string" || !params.instruction.trim()) {
    throw new Error("pipeline.author: 'instruction' must be a non-empty string");
  }
  const ctx = requireContext();
  const providers = await ctx.listProviders();
  const chatAdapters = await ctx.listChatAdapters();
  const systemPrompt = buildSystemPrompt({ providers, chatAdapters });
  const userPrompt = buildUserPrompt(params);
  const maxOuter = ctx.maxOuterRetries ?? 2;
  // Lazy import: a static `import { route }` here creates a command → router →
  // llmRegistry → _loaders cycle that breaks adapter init order in the bundled
  // build (same reason server.ts dynamic-imports chat-bubble/discord).
  const callRoute = ctx.route ?? (await import("../router.ts")).route;

  let lastKind = "unknown";
  let lastText = "";
  for (let attemptIdx = 0; attemptIdx <= maxOuter; attemptIdx++) {
    let captured: PipelineDefinition | null = null;
    const tool = makePipelineSubmitTool({
      description:
        "Submit the final pipeline definition. Must be called exactly once with the complete pipeline.",
      onSubmit: (pipeline) => {
        captured = pipeline;
        return `Recorded pipeline "${pipeline.name}" with ${pipeline.nodes.length} node(s).`;
      },
    });
    const reinforcement =
      attemptIdx === 0
        ? ""
        : `\n\nReminder: you did not call submit_pipeline last time. You MUST call it with a valid pipeline definition.`;

    const result = await callRoute({
      prompt: userPrompt + reinforcement,
      systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [tool as any],
    });
    lastKind = result.kind;
    lastText = result.text;

    if (captured) {
      return {
        yaml: YAML.stringify(captured),
        explanation: result.text.trim() || "(no explanation provided)",
        kind: result.kind,
      };
    }
  }

  throw new Error(
    `pipeline.author: LLM did not call submit_pipeline after ${maxOuter + 1} attempts (kind=${lastKind}, last_text=${lastText.slice(0, 120)})`,
  );
}

const handlers = {
  "pipeline.author": (params: PipelineAuthorParams) => pipelineAuthor(params),
} as const;

export type PipelineAuthorCommandMap = typeof handlers;
export default handlers;
