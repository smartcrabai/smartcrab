import { loadChatAdapters, loadLlmAdapters } from "./_loaders";

/**
 * Generic adapter registry.
 *
 * Adapters live under `src/adapters/<kind>/<name>/index.ts` and self-register
 * by calling `llmRegistry.register(...)` / `chatRegistry.register(...)` at
 * module load time. `ensureAdaptersLoaded()` triggers the side-effect imports
 * for every adapter file (filesystem-scanned in dev, statically inlined by
 * the build plugin in production).
 */

export interface Identifiable {
  id: string;
}

export class AdapterRegistry<T extends Identifiable> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(adapter: T): void {
    if (this.entries.has(adapter.id)) {
      console.error(
        `[registry:${this.kind}] duplicate adapter "${adapter.id}" — overriding`,
      );
    }
    this.entries.set(adapter.id, adapter);
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  /** Throws if the adapter is not registered. */
  require(id: string): T {
    const adapter = this.entries.get(id);
    if (!adapter) {
      throw new Error(
        `[registry:${this.kind}] adapter not found: "${id}" (registered: ${this.list().join(", ") || "<none>"})`,
      );
    }
    return adapter;
  }

  list(): string[] {
    return [...this.entries.keys()].sort();
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Minimal LLM/Chat adapter shapes — replaced by `@smartcrab/ipc-protocol`
 * (Unit 2) once that package is available.
 */
export interface LlmAdapterLike extends Identifiable {
  readonly id: string;
  readonly displayName?: string;
}

export interface ChatAdapterLike extends Identifiable {
  readonly id: string;
  readonly displayName?: string;
}

export const llmRegistry = new AdapterRegistry<LlmAdapterLike>("llm");
export const chatRegistry = new AdapterRegistry<ChatAdapterLike>("chat");

let adaptersLoadedPromise: Promise<void> | null = null;

/** Trigger one-time adapter loading. Idempotent and safe to call repeatedly. */
export function ensureAdaptersLoaded(): Promise<void> {
  if (!adaptersLoadedPromise) {
    adaptersLoadedPromise = Promise.all([
      loadLlmAdapters().catch((err) =>
        console.error("[registry] llm load error:", err),
      ),
      loadChatAdapters().catch((err) =>
        console.error("[registry] chat load error:", err),
      ),
    ]).then(() => undefined);
  }
  return adaptersLoadedPromise;
}
