/**
 * Adapter interfaces ported from
 * `crates/smartcrab-app/src-tauri/src/adapters/{chat,llm}/mod.rs`.
 *
 * These are the runtime contracts the Bun service implements; the SwiftUI
 * client never implements them directly but knows the shape so it can
 * inspect capabilities and render appropriate UI.
 */

// ─── LLM ──────────────────────────────────────────────────────────────────

/** Declares what an LLM provider can do. */
export interface LlmCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  maxContextTokens: number;
}

/** A normalized prompt request sent to any LLM adapter. */
export interface LlmRequest {
  prompt: string;
  timeoutSecs?: number;
  metadata?: Record<string, unknown> | null;
}

/** A normalized response returned from any LLM adapter. */
export interface LlmResponse {
  content: string;
  metadata?: Record<string, unknown> | null;
}

/** Trait that every LLM-provider adapter must implement. */
export interface LlmAdapter {
  /** Unique machine-readable identifier (e.g. `"claude"`). */
  readonly id: string;
  /** Human-readable display name (e.g. `"Claude"`). */
  readonly name: string;
  /** Static capability declaration for this provider. */
  capabilities(): LlmCapabilities;
  /** Sends a prompt and waits for the complete response. */
  executePrompt(request: LlmRequest): Promise<LlmResponse>;
  /** Streams a prompt response (defaults to `executePrompt`). */
  streamPrompt?(request: LlmRequest): Promise<LlmResponse>;
}

// ─── Chat ─────────────────────────────────────────────────────────────────

/** Declares what a chat platform can do. */
export interface ChatCapabilities {
  threads: boolean;
  reactions: boolean;
  fileUpload: boolean;
  streaming: boolean;
  directMessage: boolean;
  groupMessage: boolean;
}

/** Trait that every chat-platform adapter must implement. */
export interface ChatAdapter {
  /** Unique machine-readable identifier (e.g. `"discord"`). */
  readonly id: string;
  /** Human-readable display name (e.g. `"Discord"`). */
  readonly name: string;
  /** Static capability declaration for this platform. */
  capabilities(): ChatCapabilities;
  /** Sends a text message to the specified channel. */
  sendMessage(channelId: string, content: string): Promise<void>;
  /** Starts the background listener (bot loop, websocket, etc.). */
  startListener(): Promise<void>;
  /** Gracefully stops the background listener. */
  stopListener(): Promise<void>;
  /** Returns `true` when the listener is actively running. */
  isRunning(): boolean;
}
