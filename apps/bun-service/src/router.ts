import { llmRegistry, type LlmAdapterLike } from "./registry";

/**
 * Router shell.
 *
 * The eventual implementation will:
 *  1. Take a smartcrab config (defined in `@smartcrab/seher-config-schema`),
 *  2. Translate it to a seher-ts settings shape,
 *  3. Build a seher-ts router that picks an LLM adapter per request
 *     (priority / time-window / fallback rules from the smartcrab schema).
 *
 * For now we keep the surface minimal: try to import seher-ts at runtime;
 * if it isn't installed (it's an optional dependency), fall back to a
 * direct lookup against `llmRegistry`.
 *
 * TODO(Unit 3 + seher integration): replace the fallback with a real
 * seher-ts router built from `translate(smartcrabConfig)`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SmartcrabConfig = any;

export interface Router {
  pick(hint?: { provider?: string }): LlmAdapterLike;
  list(): string[];
}

export async function buildRouter(
  smartcrabConfig?: SmartcrabConfig,
): Promise<Router> {
  // Attempt to dynamically pull in seher-ts. We swallow the error because
  // the package is declared as `optionalDependencies` and may legitimately
  // be missing in tests / dev environments.
  try {
    // @ts-expect-error optional peer
    await import("seher-ts");
    // TODO: build seher router from translated config and route through it.
  } catch {
    // fall through to direct registry lookup
  }

  void smartcrabConfig; // reserved for future use

  return {
    pick(hint) {
      const requested = hint?.provider;
      if (requested) return llmRegistry.require(requested);
      const [first] = llmRegistry.list();
      if (!first) {
        throw new Error("router: no LLM adapters registered");
      }
      return llmRegistry.require(first);
    },
    list() {
      return llmRegistry.list();
    },
  };
}
