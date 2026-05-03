/**
 * Shared helpers for LLM adapters.
 *
 * These will likely move under `src/lib/` once Unit 4 lands a proper shared
 * module layout; until then they live next to the adapters that use them.
 */

export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  msg: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Probe a list of candidate npm package names and return the first one that
 * loads and matches `pick`. Falls back to `fallback` if none resolves.
 *
 * Used by adapters whose vendor SDK npm name is not yet pinned, so we try a
 * few likely names and degrade to a mock in dev.
 */
export async function resolveOptionalSdk<T>(
  candidates: readonly string[],
  pick: (mod: unknown) => T | undefined,
  fallback: T,
): Promise<T> {
  for (const name of candidates) {
    try {
      const mod: unknown = await import(name);
      const found = pick(mod);
      if (found) return found;
      const def = (mod as { default?: unknown }).default;
      const fromDefault = pick(def);
      if (fromDefault) return fromDefault;
    } catch {
      // try next
    }
  }
  return fallback;
}
