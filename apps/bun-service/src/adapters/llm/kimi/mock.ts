/**
 * Mock shim for the Kimi Agent SDK.
 *
 * TODO(Unit 11): swap to the real `@moonshotai/kimi-agent-sdk` (or whichever
 * npm name MoonshotAI publishes) once it is available on the registry.
 * The real SDK reference: https://github.com/MoonshotAI/kimi-agent-sdk
 *
 * Shape kept intentionally minimal: a `Session` with a `run(prompt)` method
 * returning `{ content }`. The adapter only depends on this surface.
 */

export interface KimiSessionRunResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface KimiSession {
  run(prompt: string): Promise<KimiSessionRunResult>;
}

export interface KimiSessionOptions {
  apiKey?: string;
  model?: string;
}

export interface KimiSdkLike {
  Session: new (opts?: KimiSessionOptions) => KimiSession;
}

class MockSession implements KimiSession {
  constructor(_opts?: KimiSessionOptions) {}
  async run(prompt: string): Promise<KimiSessionRunResult> {
    return {
      content: `[kimi-mock] ${prompt}`,
      metadata: { mock: true },
    };
  }
}

export const mockKimiSdk: KimiSdkLike = {
  Session: MockSession,
};
