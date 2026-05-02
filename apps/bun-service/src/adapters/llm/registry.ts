/**
 * Lightweight LLM adapter registry stub.
 *
 * Mirrors `chatRegistry` semantics; provides a default routing point so the
 * Discord listener can hand incoming messages off to whatever LLM is active.
 */
export interface LlmRequest {
  prompt: string;
  context?: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
}

export interface LlmAdapter {
  readonly id: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmRegistry {
  private adapters = new Map<string, LlmAdapter>();
  private defaultId: string | null = null;

  register(adapter: LlmAdapter, options?: { default?: boolean }): void {
    this.adapters.set(adapter.id, adapter);
    if (options?.default || this.defaultId === null) {
      this.defaultId = adapter.id;
    }
  }

  get(id: string): LlmAdapter | undefined {
    return this.adapters.get(id);
  }

  default(): LlmAdapter | undefined {
    if (!this.defaultId) return undefined;
    return this.adapters.get(this.defaultId);
  }

  list(): LlmAdapter[] {
    return Array.from(this.adapters.values());
  }

  clear(): void {
    this.adapters.clear();
    this.defaultId = null;
  }
}

const REGISTRY_KEY = Symbol.for("@smartcrab/bun-service/llm-registry");

interface GlobalRegistryHost {
  [REGISTRY_KEY]?: LlmRegistry;
}

const host = globalThis as GlobalRegistryHost;
if (!host[REGISTRY_KEY]) {
  host[REGISTRY_KEY] = new LlmRegistry();
}

export const llmRegistry: LlmRegistry = host[REGISTRY_KEY]!;
