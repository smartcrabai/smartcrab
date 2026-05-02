/**
 * Inline `LlmAdapter` port and supporting types.
 *
 * In the long-term layout these come from `@smartcrab/ipc-protocol` (Unit 2).
 * This module is a self-contained fallback so Unit 10 can be merged
 * independently of Unit 2's package finalisation.
 *
 * Once `@smartcrab/ipc-protocol` is in place, this file can be replaced with
 * a re-export.
 */

/**
 * Static capabilities declared by an LLM adapter.
 */
export interface LlmCapabilities {
  /** Whether the adapter supports streaming responses. */
  readonly streaming: boolean;
  /** Whether the adapter supports tool/function calling. */
  readonly tools: boolean;
  /** Maximum context window the adapter advertises. */
  readonly maxContextTokens: number;
}

/**
 * A single message in a chat-style conversation.
 */
export interface LlmMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

/**
 * Tool definition surfaced to the agent at request time.
 *
 * The shape mirrors the JSON Schema-based definitions used by
 * `@anthropic-ai/claude-agent-sdk` so adapters can pass them through directly.
 */
export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/**
 * A normalised request sent to any LLM adapter.
 */
export interface LlmRequest {
  /** Either a single prompt or a multi-turn conversation. */
  readonly prompt?: string;
  readonly messages?: readonly LlmMessage[];
  /** Optional list of tools to expose to the model. */
  readonly tools?: readonly LlmToolDefinition[];
  /** Adapter-specific options (model name, temperature, etc.). */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Hard deadline in seconds; adapters should abort the call when exceeded. */
  readonly timeoutSecs?: number;
}

/**
 * A normalised response returned by any LLM adapter.
 */
export interface LlmResponse {
  readonly content: string;
  readonly toolCalls?: readonly LlmToolCall[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A tool invocation captured from the model output.
 */
export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/**
 * Trait every LLM adapter must implement.
 */
export interface LlmAdapter {
  readonly id: string;
  readonly capabilities: LlmCapabilities;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
