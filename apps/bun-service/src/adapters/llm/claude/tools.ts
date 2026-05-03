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
 * model returns a `tool_use` block matching `definition.name`.
 */
export interface ClaudeTool {
  readonly definition: LlmToolDefinition;
  handler(input: unknown): Promise<unknown>;
}

/**
 * Returns the current Smartcrab configuration via an injectable provider so
 * tests can stub the value without touching real disk / DB state.
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

const emptyConfig = (): Record<string, unknown> => ({});

export function defaultClaudeTools(): readonly ClaudeTool[] {
  return [makeGetCurrentSmartcrabConfigTool(emptyConfig)];
}
