/**
 * GitHub Copilot LLM adapter.
 *
 * Reference: https://github.com/github/copilot-sdk
 *
 * Copilot SDK speaks JSON-RPC and routes tool calls over MCP. We wrap that
 * with the standard `LlmAdapter` shape; tool/MCP wiring stays with the SDK
 * itself (capabilities flag `native: "copilot"` signals the special tool
 * path to upstream code).
 *
 * Like Kimi, the SDK npm name is not yet pinned, so we attempt a dynamic
 * import and fall back to a mock shim (see `./mock.ts`).
 */

import { registerLlmAdapter } from "../registry.ts";
import type {
  LlmAdapter,
  LlmCapabilities,
  LlmRequest,
  LlmResponse,
} from "../types.ts";
import { resolveOptionalSdk, withTimeout } from "../util.ts";
import {
  mockCopilotSdk,
  type CopilotClient,
  type CopilotClientOptions,
  type CopilotSdkLike,
} from "./mock.ts";

const ADAPTER_ID = "copilot";
const ADAPTER_NAME = "GitHub Copilot";
const DEFAULT_TIMEOUT_SECS = 120;
const RPC_METHOD = "chat.complete";

const SDK_CANDIDATES = [
  "@github/copilot-sdk",
  "copilot-sdk",
  "@githubnext/copilot-sdk",
] as const;

export function resolveCopilotSdk(): Promise<CopilotSdkLike> {
  return resolveOptionalSdk<CopilotSdkLike>(
    SDK_CANDIDATES,
    (mod) => {
      const candidate = mod as Partial<CopilotSdkLike> | undefined;
      return candidate?.Client ? (candidate as CopilotSdkLike) : undefined;
    },
    mockCopilotSdk,
  );
}

export interface CopilotAdapterOptions extends CopilotClientOptions {
  /** Inject a pre-resolved SDK (for tests). */
  sdk?: CopilotSdkLike;
}

export class CopilotLlmAdapter implements LlmAdapter {
  readonly id = ADAPTER_ID;
  readonly name = ADAPTER_NAME;
  /**
   * Copilot routes tools through MCP via JSON-RPC; `native: "copilot"`
   * signals the registry router to use that tool surface instead of a
   * generic schema.
   */
  readonly capabilities: LlmCapabilities = {
    streaming: true,
    tools: true,
    native: "copilot",
    maxContextTokens: 128_000,
  };

  private sdkPromise: Promise<CopilotSdkLike>;
  private clientPromise: Promise<CopilotClient> | undefined;

  constructor(private readonly opts: CopilotAdapterOptions = {}) {
    this.sdkPromise = opts.sdk
      ? Promise.resolve(opts.sdk)
      : resolveCopilotSdk();
  }

  private async getClient(): Promise<CopilotClient> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const sdk = await this.sdkPromise;
        return new sdk.Client({
          token: this.opts.token,
          mcpServers: this.opts.mcpServers,
        });
      })();
    }
    return this.clientPromise;
  }

  async executePrompt(req: LlmRequest): Promise<LlmResponse> {
    const timeoutMs = (req.timeoutSecs ?? DEFAULT_TIMEOUT_SECS) * 1000;
    const client = await this.getClient();

    const rpc = await withTimeout(
      client.request<{ content: string; metadata?: Record<string, unknown> }>(
        RPC_METHOD,
        { prompt: req.prompt, metadata: req.metadata },
      ),
      timeoutMs,
      `${ADAPTER_ID}: timed out after ${timeoutMs / 1000}s`,
    );

    if (rpc.error) {
      throw new Error(
        `${ADAPTER_ID}: rpc error ${rpc.error.code}: ${rpc.error.message}`,
      );
    }
    if (!rpc.result) {
      throw new Error(`${ADAPTER_ID}: rpc returned empty result`);
    }
    return { content: rpc.result.content, metadata: rpc.result.metadata };
  }

  async streamPrompt(req: LlmRequest): Promise<LlmResponse> {
    return this.executePrompt(req);
  }
}

// Self-registers on import (see kimi adapter for rationale).
registerLlmAdapter(new CopilotLlmAdapter());
