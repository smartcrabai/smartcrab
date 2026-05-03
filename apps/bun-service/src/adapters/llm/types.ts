/**
 * Inline `LlmAdapter` port. Replaceable with a re-export from
 * `@smartcrab/ipc-protocol` once Unit 2 lands.
 */

export interface LlmCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly maxContextTokens: number;
}

export interface LlmMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

/**
 * Mirrors the JSON Schema-based tool shape used by
 * `@anthropic-ai/claude-agent-sdk` so adapters can pass it through directly.
 */
export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  readonly prompt?: string;
  readonly messages?: readonly LlmMessage[];
  readonly tools?: readonly LlmToolDefinition[];
  readonly options?: Readonly<Record<string, unknown>>;
  /** Hard deadline in seconds; adapters should abort the call when exceeded. */
  readonly timeoutSecs?: number;
}

export interface LlmResponse {
  readonly content: string;
  readonly toolCalls?: readonly LlmToolCall[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface LlmAdapter {
  readonly id: string;
  readonly capabilities: LlmCapabilities;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
