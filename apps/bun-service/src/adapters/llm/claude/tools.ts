/**
 * Custom tools exposed to the Claude agent.
 *
 * Each tool is described by a JSON Schema so Anthropic's tool-use machinery
 * can validate inputs. The handler is invoked locally by the adapter when
 * the model emits a matching `tool_use` block.
 */

import type { LlmToolDefinition } from "../types.ts";

/**
 * A locally executable tool. The Claude adapter invokes `handler` when the
 * model returns a `tool_use` block whose `name` matches `definition.name`.
 */
export interface ClaudeTool {
  readonly definition: LlmToolDefinition;
  handler(input: unknown): Promise<unknown>;
}

/**
 * Returns the current Smartcrab service configuration.
 *
 * Backed by an injectable provider so tests can stub the value without
 * touching real disk / DB state.
 */
export function makeGetCurrentSmartcrabConfigTool(
  provider: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): ClaudeTool {
  return {
    definition: {
      name: "getCurrentSmartcrabConfig",
      description:
        "Returns the active Smartcrab configuration (providers, priorities, " +
        "time windows, fallback chain). Use this when the user asks about " +
        "their current setup or when reasoning about routing decisions.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    async handler(_input: unknown): Promise<unknown> {
      return await provider();
    },
  };
}

/**
 * Default no-op config provider used when the adapter is constructed without
 * an explicit one. Returning an empty object keeps the tool schema-valid
 * while making it obvious that no real source has been wired in yet.
 */
export const defaultSmartcrabConfigProvider = (): Record<string, unknown> => ({});

/**
 * Convenience builder used by `index.ts` and tests.
 */
export function defaultClaudeTools(): readonly ClaudeTool[] {
  return [makeGetCurrentSmartcrabConfigTool(defaultSmartcrabConfigProvider)];
}
