/**
 * Generic adapter registry.
 *
 * Adapters live under `src/adapters/<kind>/<name>/index.ts` and self-register
 * by calling `llmRegistry.register(...)` / `chatRegistry.register(...)` at
 * module load time. The side-effect imports below ensure every adapter file
 * is evaluated when the bundle is built.
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
 * Minimal LLM adapter shape — replaced by `@smartcrab/ipc-protocol`'s
 * `LlmAdapter` interface once that package is available.
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

// Side-effect imports — adapter index.ts files self-register when evaluated.
import.meta.glob("./adapters/llm/*/index.ts", { eager: true });
import.meta.glob("./adapters/chat/*/index.ts", { eager: true });
