/**
 * Lightweight LLM adapter registry.
 *
 * Adapters self-register at module load time so that downstream code
 * (router, command handlers) can look them up by id without static imports.
 *
 * Once Unit 4's `AdapterRegistry<T>` is in place this module can be replaced
 * with a re-export from `apps/bun-service/src/registry.ts`.
 */

import type { LlmAdapter } from "./types.ts";

/**
 * Internal map keyed by adapter id.
 */
const adapters = new Map<string, LlmAdapter>();

/**
 * Singleton registry exposed to adapter modules.
 */
export const llmRegistry = {
  /**
   * Registers an adapter. Re-registering the same id overwrites the previous
   * entry — useful for hot-swapping in tests.
   */
  register(adapter: LlmAdapter): void {
    adapters.set(adapter.id, adapter);
  },

  /**
   * Looks up an adapter by id, returning `undefined` when none is registered.
   */
  get(id: string): LlmAdapter | undefined {
    return adapters.get(id);
  },

  /**
   * Lists all currently registered adapters.
   */
  list(): readonly LlmAdapter[] {
    return [...adapters.values()];
  },

  /**
   * Removes a single adapter; returns `true` when something was removed.
   * Primarily used by tests to keep state isolated between cases.
   */
  unregister(id: string): boolean {
    return adapters.delete(id);
  },

  /**
   * Removes every registered adapter. Test-only convenience.
   */
  clear(): void {
    adapters.clear();
  },
} as const;
