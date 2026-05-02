/**
 * Claude LLM adapter — wraps `@anthropic-ai/claude-agent-sdk` so it conforms
 * to the project's `LlmAdapter` port.
 *
 * Self-registers with `llmRegistry` at module load so any code path that does
 * `import "./adapters/llm/claude"` (or relies on `import.meta.glob` auto
 * discovery) can resolve the adapter via `llmRegistry.get("claude")`.
 */

import { llmRegistry } from "../registry.ts";
import type {
  LlmAdapter,
  LlmCapabilities,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmToolDefinition,
} from "../types.ts";
import {
  DefaultClaudeSdkClient,
  type ClaudeSdkClient,
  type ClaudeSdkRequest,
} from "./sdk.ts";
import {
  defaultClaudeTools,
  type ClaudeTool,
} from "./tools.ts";

/** Stable adapter identifier — referenced by registry, settings, logs. */
export const CLAUDE_ADAPTER_ID = "claude" as const;

/** Default model used when the request does not specify one. */
const DEFAULT_MODEL = "claude-sonnet-4-5";

/** Capabilities advertised by this adapter. */
const CLAUDE_CAPABILITIES: LlmCapabilities = {
  streaming: true,
  tools: true,
  maxContextTokens: 200_000,
};

/**
 * Construction-time options. All are optional — the defaults wire up the real
 * SDK and a no-op tool set so production callers can `new ClaudeLlmAdapter()`.
 */
export interface ClaudeLlmAdapterOptions {
  /** Override the SDK client. Tests pass a mock here. */
  readonly sdk?: ClaudeSdkClient;
  /** Custom tool list. Defaults to {@link defaultClaudeTools}. */
  readonly tools?: readonly ClaudeTool[];
  /** Override the default Anthropic model id. */
  readonly model?: string;
}

/**
 * Concrete adapter implementing `LlmAdapter`.
 */
export class ClaudeLlmAdapter implements LlmAdapter {
  readonly id = CLAUDE_ADAPTER_ID;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private readonly sdk: ClaudeSdkClient;
  private readonly tools: readonly ClaudeTool[];
  private readonly model: string;

  constructor(opts: ClaudeLlmAdapterOptions = {}) {
    this.sdk = opts.sdk ?? new DefaultClaudeSdkClient();
    this.tools = opts.tools ?? defaultClaudeTools();
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  /**
   * Returns the union of caller-supplied tools and the adapter's built-in
   * tool definitions. Caller tools win on name collisions.
   */
  private mergedToolDefinitions(
    requested: readonly LlmToolDefinition[] | undefined,
  ): readonly LlmToolDefinition[] {
    const builtinDefs = this.tools.map((t) => t.definition);
    if (!requested || requested.length === 0) {
      return builtinDefs;
    }
    const requestedNames = new Set(requested.map((t) => t.name));
    return [...requested, ...builtinDefs.filter((d) => !requestedNames.has(d.name))];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const messages = normaliseMessages(request);
    const tools = this.mergedToolDefinitions(request.tools);
    const timeoutSecs = request.timeoutSecs ?? 120;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSecs * 1000);

    const sdkRequest: ClaudeSdkRequest = {
      model: (request.options?.["model"] as string | undefined) ?? this.model,
      system: request.options?.["system"] as string | undefined,
      messages: messages.map((m) => ({
        // The SDK only accepts user/assistant; coerce system/tool roles to user
        // turns prefixed with their original role to preserve content.
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.role === "user" || m.role === "assistant"
          ? m.content
          : `[${m.role}] ${m.content}`,
      })),
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: request.options?.["maxTokens"] as number | undefined,
      signal: controller.signal,
    };

    try {
      const sdkResponse = await this.sdk.query(sdkRequest);
      const toolCalls: LlmToolCall[] = (sdkResponse.toolUses ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        input: u.input,
      }));

      return {
        content: sdkResponse.text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        metadata: {
          adapter: this.id,
          model: sdkRequest.model,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolves a single tool by name. Exposed primarily for tests and for the
   * future agent loop that will execute `tool_use` blocks locally.
   */
  resolveTool(name: string): ClaudeTool | undefined {
    return this.tools.find((t) => t.definition.name === name);
  }
}

/**
 * Normalises the request into a non-empty message array. Either `prompt` or
 * `messages` must be present — we mirror the Rust adapter's behaviour by
 * raising early instead of producing an empty SDK call.
 */
function normaliseMessages(request: LlmRequest): readonly LlmMessage[] {
  if (request.messages && request.messages.length > 0) {
    return request.messages;
  }
  if (typeof request.prompt === "string" && request.prompt.length > 0) {
    return [{ role: "user", content: request.prompt }];
  }
  throw new Error("ClaudeLlmAdapter: request must include `prompt` or `messages`.");
}

/**
 * Module-load self-registration. Keeping this at the bottom guarantees the
 * class is fully defined before instantiation.
 */
const defaultAdapter = new ClaudeLlmAdapter();
llmRegistry.register(defaultAdapter);

export default defaultAdapter;
