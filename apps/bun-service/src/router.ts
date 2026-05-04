/**
 * LLM router built on top of `seher-ts`.
 *
 * `seher-ts` resolves the highest-priority available coding agent
 * (Claude / Kimi / Copilot / Codex) based on the user's settings
 * (`~/.config/seher/settings.jsonc` by default — overridable via
 * `SMARTCRAB_SEHER_CONFIG`). When seher-ts is unavailable or no agent
 * resolves, we fall back to the first registered adapter in
 * `llmRegistry` so the chat tab stays usable.
 */

import { llmRegistry } from "./adapters/llm/registry";

export interface RouteRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
}

export interface RouteResponse {
  text: string;
  /** "claude" | "kimi" | "copilot" | "codex" | "registry-fallback" */
  kind: string;
}

interface SeherModule {
  SeherSDK: new (opts?: { configPath?: string; noWait?: boolean }) => {
    run: (opts: {
      prompt: string;
      model?: string;
      systemPrompt?: string;
      maxTokens?: number;
    }) => Promise<{ text: string; kind: string; raw: unknown }>;
  };
}

let cachedSdk: SeherModule | null | undefined;

async function loadSeher(): Promise<SeherModule | null> {
  if (cachedSdk !== undefined) return cachedSdk;
  try {
    cachedSdk = (await import("seher-ts")) as unknown as SeherModule;
  } catch {
    cachedSdk = null;
  }
  return cachedSdk;
}

export async function route(request: RouteRequest): Promise<RouteResponse> {
  const seher = await loadSeher();
  if (seher) {
    try {
      const sdk = new seher.SeherSDK({
        configPath: process.env.SMARTCRAB_SEHER_CONFIG,
        // Fail fast if all configured agents are rate-limited rather than
        // sleeping the chat thread until a reset.
        noWait: true,
      });
      const result = await sdk.run({
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        model: request.model,
        maxTokens: request.maxTokens,
      });
      return { text: result.text, kind: result.kind };
    } catch (err) {
      console.error("[router] seher-ts run failed; falling back:", err);
    }
  }

  // Fallback: pick the first registered LLM adapter and call it directly.
  // Used in dev environments without a seher settings file.
  const adapter = llmRegistry.default();
  if (!adapter) {
    throw new Error(
      "router: seher-ts unavailable and no LLM adapter registered (configure ~/.config/seher/settings.jsonc).",
    );
  }
  const response = await adapter.complete({
    messages: [{ role: "user", content: request.prompt }],
  });
  return { text: response.content, kind: "registry-fallback" };
}
