/**
 * LLM router built on top of `@seher-ts/sdk` (>= 0.1.13).
 *
 * Seher resolves the highest-priority available coding agent — backed by
 * Claude Agent SDK (Anthropic API-compatible), Copilot SDK, or
 * pi-coding-agent (OpenAI API-compatible) — based on the user's YAML config
 * (`$XDG_CONFIG_HOME/smartcrab/seher-config.yaml` by default, overridable
 * via `SMARTCRAB_SEHER_CONFIG`). When `@seher-ts/sdk` is unavailable or no
 * agent resolves, we fall back to the first registered adapter in
 * `llmRegistry` so the chat tab stays usable.
 */

import { llmRegistry } from "./adapters/llm/registry";
import { defaultSeherConfigPath } from "./seher/write-settings";
import type { SeherTool } from "@seher-ts/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmMessage, LlmResponse } from "./adapters/llm/types.ts";

export interface RouteRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  tools?: SeherTool[];
}

export interface RouteResponse {
  text: string;
  /** "claude" | "copilot" | "pi" | "registry-fallback" — Seher's own SDK kinds. */
  kind: string;
}

interface SeherModule {
  SeherSDK: new (opts?: { configPath?: string; noWait?: boolean; tools?: SeherTool[] }) => {
    run: (opts: {
      prompt: string;
      model?: string;
      systemPrompt?: string;
      maxTokens?: number;
    }) => Promise<{ text: string; kind: string; raw: unknown }>;
  };
}

const MAX_TOOL_ROUNDS = 10;

let cachedSdk: SeherModule | null | undefined;

async function loadSeher(): Promise<SeherModule | null> {
  if (cachedSdk !== undefined) return cachedSdk;
  try {
    cachedSdk = (await import("@seher-ts/sdk")) as unknown as SeherModule;
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
        // settings.app-save writes a seher-ts settings.jsonc here; respect
        // SMARTCRAB_SEHER_CONFIG for callers who want to override the path.
        configPath: defaultSeherConfigPath(),
        // Fail fast if all configured agents are rate-limited rather than
        // sleeping the chat thread until a reset.
        noWait: true,
        tools: request.tools,
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

  const toolDefs = request.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.parameters, { target: "openApi3" }) as Record<string, unknown>,
  }));

  const toolMap = new Map(request.tools?.map((t) => [t.name, t]) ?? []);
  const messages: LlmMessage[] = [{ role: "user", content: request.prompt }];

  let lastResponse = await adapter.complete({ messages, tools: toolDefs });
  for (let _round = 1; _round < MAX_TOOL_ROUNDS && lastResponse.toolCalls?.length; _round++) {
    if (lastResponse.content) {
      messages.push({ role: "assistant", content: lastResponse.content });
    }

    const results = await Promise.all(
      lastResponse.toolCalls.map(async (call) => {
        const tool = toolMap.get(call.name);
        if (tool) {
          try {
            const parsed = tool.parameters.parse(call.input);
            const raw = await tool.handler(parsed);
            return typeof raw === "string" ? raw : JSON.stringify(raw);
          } catch (err) {
            return `[tool error: ${call.name} - ${err instanceof Error ? err.message : String(err)}]`;
          }
        }
        return `[unknown tool: ${call.name}]`;
      }),
    );
    for (const result of results) {
      messages.push({ role: "tool", content: result });
    }
    lastResponse = await adapter.complete({ messages, tools: toolDefs });
  }

  return { text: lastResponse.content, kind: "registry-fallback" };
}
