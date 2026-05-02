/**
 * Local fallback `LlmAdapter` interface.
 *
 * Once `@smartcrab/ipc-protocol` (Unit 2) is merged, this file can be replaced
 * by a re-export from that package. Kept here so Unit 11 can compile + test
 * independently of the protocol package's shape.
 *
 * Mirrors the Rust trait at
 * `crates/smartcrab-app/src-tauri/src/adapters/llm/mod.rs`.
 */

export interface LlmCapabilities {
  /** Streaming supported. */
  streaming: boolean;
  /** Native tool/function calling supported. */
  tools: boolean;
  /** Adapter-native flavor tag (e.g. `"kimi"`, `"copilot"`). */
  native?: string;
  /** Maximum context tokens (best-effort, may be undefined). */
  maxContextTokens?: number;
}

export interface LlmRequest {
  prompt: string;
  timeoutSecs?: number;
  metadata?: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface LlmAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: LlmCapabilities;
  executePrompt(req: LlmRequest): Promise<LlmResponse>;
  streamPrompt?(req: LlmRequest): Promise<LlmResponse>;
}
