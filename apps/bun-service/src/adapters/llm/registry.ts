/**
 * Minimal adapter registry. Will be superseded by the generic
 * `AdapterRegistry<T>` from Unit 4 (`apps/bun-service/src/registry.ts`).
 * Self-registration in Unit 11 calls `registerLlmAdapter(...)` so swapping
 * is mechanical.
 */

import type { LlmAdapter } from "./types.ts";

const registry = new Map<string, LlmAdapter>();

export function registerLlmAdapter(adapter: LlmAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getLlmAdapter(id: string): LlmAdapter | undefined {
  return registry.get(id);
}

export function listLlmAdapters(): LlmAdapter[] {
  return [...registry.values()];
}

/** Test helper. */
export function clearLlmAdapters(): void {
  registry.clear();
}
