/**
 * Kimi LLM adapter — wraps the MoonshotAI Kimi Agent SDK Session API.
 *
 * Reference: https://github.com/MoonshotAI/kimi-agent-sdk
 *
 * The real SDK npm name is not yet pinned in the codebase. We attempt a
 * dynamic import and fall back to a mock shim (see `./mock.ts`) so this
 * unit can land independently and tests stay green.
 */

import { registerLlmAdapter } from "../registry.ts";
import type {
  LlmAdapter,
  LlmCapabilities,
  LlmRequest,
  LlmResponse,
} from "../types.ts";
import { resolveOptionalSdk, withTimeout } from "../util.ts";
import { mockKimiSdk, type KimiSdkLike, type KimiSession } from "./mock.ts";

const ADAPTER_ID = "kimi";
const ADAPTER_NAME = "Kimi";
const DEFAULT_TIMEOUT_SECS = 120;

const SDK_CANDIDATES = [
  "@moonshotai/kimi-agent-sdk",
  "kimi-agent-sdk",
  "@moonshot/kimi-agent-sdk",
] as const;

export function resolveKimiSdk(): Promise<KimiSdkLike> {
  return resolveOptionalSdk<KimiSdkLike>(
    SDK_CANDIDATES,
    (mod) => {
      const candidate = mod as Partial<KimiSdkLike> | undefined;
      return candidate?.Session ? (candidate as KimiSdkLike) : undefined;
    },
    mockKimiSdk,
  );
}

export interface KimiAdapterOptions {
  apiKey?: string;
  model?: string;
  /** Inject a pre-resolved SDK (for tests). */
  sdk?: KimiSdkLike;
}

export class KimiLlmAdapter implements LlmAdapter {
  readonly id = ADAPTER_ID;
  readonly name = ADAPTER_NAME;
  readonly capabilities: LlmCapabilities = {
    streaming: true,
    tools: true,
    native: "kimi",
    maxContextTokens: 200_000,
  };

  private sdkPromise: Promise<KimiSdkLike>;
  private sessionPromise: Promise<KimiSession> | undefined;

  constructor(private readonly opts: KimiAdapterOptions = {}) {
    this.sdkPromise = opts.sdk
      ? Promise.resolve(opts.sdk)
      : resolveKimiSdk();
  }

  private async getSession(): Promise<KimiSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const sdk = await this.sdkPromise;
        return new sdk.Session({
          apiKey: this.opts.apiKey,
          model: this.opts.model,
        });
      })();
    }
    return this.sessionPromise;
  }

  async executePrompt(req: LlmRequest): Promise<LlmResponse> {
    const timeoutMs = (req.timeoutSecs ?? DEFAULT_TIMEOUT_SECS) * 1000;
    const session = await this.getSession();

    const result = await withTimeout(
      session.run(req.prompt),
      timeoutMs,
      `${ADAPTER_ID}: timed out after ${timeoutMs / 1000}s`,
    );

    return { content: result.content, metadata: result.metadata };
  }

  async streamPrompt(req: LlmRequest): Promise<LlmResponse> {
    return this.executePrompt(req);
  }
}

// Self-registers on import so `import.meta.glob('./adapters/llm/*/index.ts')`
// (Unit 4) wires this adapter without explicit references.
registerLlmAdapter(new KimiLlmAdapter());
