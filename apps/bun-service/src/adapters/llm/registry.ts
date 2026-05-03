/**
 * Lightweight LLM adapter registry.
 *
 * Adapters self-register at module load so downstream code can look them up
 * by id without static imports. Replaceable once Unit 4's
 * `AdapterRegistry<T>` lands.
 */

import type { LlmAdapter } from "./types.ts";

const adapters = new Map<string, LlmAdapter>();

export const llmRegistry = {
  register(adapter: LlmAdapter): void {
    adapters.set(adapter.id, adapter);
  },

  get(id: string): LlmAdapter | undefined {
    return adapters.get(id);
  },

  list(): readonly LlmAdapter[] {
    return [...adapters.values()];
  },

  unregister(id: string): boolean {
    return adapters.delete(id);
  },

  clear(): void {
    adapters.clear();
  },
} as const;
