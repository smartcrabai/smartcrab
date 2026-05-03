import { llmRegistry as coreRegistry } from "../../registry";
import type { LlmAdapter } from "./types.ts";

const adapters = new Map<string, LlmAdapter>();

export const llmRegistry = {
  register(adapter: LlmAdapter): void {
    adapters.set(adapter.id, adapter);
    coreRegistry.register(adapter);
  },

  get(id: string): LlmAdapter | undefined {
    return adapters.get(id);
  },

  list(): readonly LlmAdapter[] {
    return [...adapters.values()];
  },

  default(): LlmAdapter | undefined {
    return adapters.values().next().value;
  },

  unregister(id: string): boolean {
    return adapters.delete(id);
  },

  clear(): void {
    adapters.clear();
    coreRegistry.clear();
  },
} as const;

export function registerLlmAdapter(adapter: LlmAdapter): void {
  llmRegistry.register(adapter);
}

export function clearLlmAdapters(): void {
  llmRegistry.clear();
}

export function getLlmAdapter(id: string): LlmAdapter | undefined {
  return llmRegistry.get(id);
}

export function listLlmAdapters(): readonly LlmAdapter[] {
  return llmRegistry.list();
}
