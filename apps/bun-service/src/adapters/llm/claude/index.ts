/**
 * Claude LLM adapter — wraps `@anthropic-ai/claude-agent-sdk` to conform to
 * the project's `LlmAdapter` port. Self-registers with `llmRegistry` at
 * module load so callers can resolve it via `llmRegistry.get("claude")`.
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

export const CLAUDE_ADAPTER_ID = "claude" as const;
const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_TIMEOUT_SECS = 120;

const CLAUDE_CAPABILITIES: LlmCapabilities = {
  streaming: true,
  tools: true,
  maxContextTokens: 200_000,
};

export interface ClaudeLlmAdapterOptions {
  readonly sdk?: ClaudeSdkClient;
  readonly tools?: readonly ClaudeTool[];
  readonly model?: string;
}

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

  /** Caller tools win on name collisions. */
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
    const timeoutSecs = request.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;
    const options = request.options ?? {};

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSecs * 1000);

    const sdkRequest: ClaudeSdkRequest = {
      model: (options["model"] as string | undefined) ?? this.model,
      system: options["system"] as string | undefined,
      messages: messages.map(toSdkMessage),
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: options["maxTokens"] as number | undefined,
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
        metadata: { adapter: this.id, model: sdkRequest.model },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  resolveTool(name: string): ClaudeTool | undefined {
    return this.tools.find((t) => t.definition.name === name);
  }
}

/**
 * The SDK only accepts user/assistant roles; system/tool turns are folded
 * into user messages with a role prefix so their content survives.
 */
function toSdkMessage(m: LlmMessage): { role: "user" | "assistant"; content: string } {
  if (m.role === "assistant") return { role: "assistant", content: m.content };
  if (m.role === "user") return { role: "user", content: m.content };
  return { role: "user", content: `[${m.role}] ${m.content}` };
}

function normaliseMessages(request: LlmRequest): readonly LlmMessage[] {
  if (request.messages && request.messages.length > 0) {
    return request.messages;
  }
  if (typeof request.prompt === "string" && request.prompt.length > 0) {
    return [{ role: "user", content: request.prompt }];
  }
  throw new Error("ClaudeLlmAdapter: request must include `prompt` or `messages`.");
}

const defaultAdapter = new ClaudeLlmAdapter();
llmRegistry.register(defaultAdapter);

export default defaultAdapter;
