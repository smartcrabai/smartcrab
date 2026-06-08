/**
 * RPC handler for listing the models available to an LLM provider.
 *
 * Method (RPC params/results use snake_case keys — the Swift client encodes with
 * convertToSnakeCase and decodes with convertFromSnakeCase):
 *   - `models.list (kind, api_key?, base_url?)` -> { models: string[] }
 *
 * Spawns `seher-bridge models <provider>` (see crates/seher-bridge) and relays
 * its single NDJSON terminal frame (`models` -> the list, `models_error` ->
 * throw). The bridge delegates to pi, which does a live fetch when a credential
 * is available — GitHub Copilot via auth.json (token exchange), OpenAI-compatible
 * via `/v1/models` — and otherwise serves pi's static model registry.
 *
 * Credentials: OAuth providers (copilot) need nothing here — pi reads auth.json
 * directly. Key-based providers (openai / anthropic) are passed the key the user
 * typed in the editor via the provider's canonical env var, since it may not yet
 * be persisted to auth.json. `openai-codex` has no listing endpoint and is a
 * fixed set hardcoded in the GUI, so it is intentionally not handled here.
 */

import { resolveBridgePath } from "../router.ts";
import { readLines } from "../seher/ndjson.ts";

// ── kinds & providers ────────────────────────────────────────────────────────

/** GUI provider kinds whose models can be listed → pi canonical provider id. */
const KIND_TO_PROVIDER: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  copilot: "github-copilot",
};

/** Env var carrying the API key for each key-based kind (OAuth kinds omit it). */
const KIND_API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** How long `models.list` waits for the bridge to emit its terminal frame. */
const LIST_TIMEOUT_MS = 20_000;

// ── bridge spawn seam ────────────────────────────────────────────────────────

/** Minimal shape of `Bun.spawn`'s return value that the models flow depends on. */
export interface SpawnedModelsBridge {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill?: (signal?: number) => unknown;
}

export type ModelsBridgeSpawn = (
  bridgePath: string,
  args: string[],
  env: Record<string, string>,
) => SpawnedModelsBridge;

const defaultModelsBridgeSpawn: ModelsBridgeSpawn = (bridgePath, args, env) =>
  Bun.spawn([bridgePath, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  }) as unknown as SpawnedModelsBridge;

let modelsBridgeSpawn: ModelsBridgeSpawn = defaultModelsBridgeSpawn;

/**
 * Test-only seam: override how the models bridge process is spawned so tests can
 * script the NDJSON frame in-process. Pass `null` to restore `Bun.spawn`.
 */
export function __setModelsBridgeSpawn(fn: ModelsBridgeSpawn | null): void {
  modelsBridgeSpawn = fn ?? defaultModelsBridgeSpawn;
}

// ── frame parsing ────────────────────────────────────────────────────────────

interface ModelsFrame {
  type?: string;
  [k: string]: unknown;
}

function parseFrame(line: string): ModelsFrame | null {
  try {
    return JSON.parse(line) as ModelsFrame;
  } catch {
    return null;
  }
}

/** Forward the bridge's stderr lines to our own logs for diagnostics. */
async function pipeStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const line of readLines(stream)) {
      console.error("[seher-bridge models]", line);
    }
  } catch {
    // best-effort
  }
}

/** Reject after `ms`, so a hung bridge cannot hang the RPC. */
function timeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
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

// ── models.list ──────────────────────────────────────────────────────────────

interface ModelsListResult {
  models: string[];
}

async function modelsList(params: {
  kind?: string;
  api_key?: string;
  base_url?: string;
  refresh?: boolean;
}): Promise<ModelsListResult> {
  const kind = params?.kind;
  const provider = kind ? KIND_TO_PROVIDER[kind] : undefined;
  if (!provider) {
    throw new Error(
      `models.list: unsupported kind '${kind}' (expected ${Object.keys(KIND_TO_PROVIDER).join(" | ")})`,
    );
  }

  const bridgePath = resolveBridgePath();
  if (!bridgePath) {
    throw new Error(
      "models.list: seher-bridge binary not found (set SMARTCRAB_SEHER_BRIDGE or rebuild the app bundle)",
    );
  }

  // Pass the editor-entered key/endpoint via the provider's canonical env vars
  // (pi resolves auth.json first, then these), inheriting the rest of the env.
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const keyEnv = kind ? KIND_API_KEY_ENV[kind] : undefined;
  if (keyEnv && params.api_key) env[keyEnv] = params.api_key;
  if (kind === "openai" && params.base_url) env.OPENAI_BASE_URL = params.base_url;

  // `refresh` bypasses pi's 5-minute model cache (the "Refresh models" action).
  const args = params.refresh ? ["models", provider, "--refresh"] : ["models", provider];
  const child = modelsBridgeSpawn(bridgePath, args, env);
  void pipeStderr(child.stderr);

  const collect = (async (): Promise<ModelsListResult> => {
    for await (const line of readLines(child.stdout)) {
      const frame = parseFrame(line);
      if (!frame) continue;
      if (frame.type === "models" && Array.isArray(frame.models)) {
        return { models: frame.models.filter((m): m is string => typeof m === "string") };
      }
      if (frame.type === "models_error") {
        const message = typeof frame.message === "string" ? frame.message : "model listing failed";
        throw new Error(message);
      }
    }
    throw new Error("models.list: seher-bridge exited without emitting a models frame");
  })();

  try {
    return await timeout(collect, LIST_TIMEOUT_MS, "models.list");
  } finally {
    // The bridge normally self-exits after its terminal frame; kill defensively
    // so a stalled process is never left behind (mirrors the run-mode cleanup).
    child.kill?.();
  }
}

// ── handlers ─────────────────────────────────────────────────────────────────

const handlers = {
  "models.list": modelsList,
} as const;

export type ModelsCommandMap = typeof handlers;
export default handlers;
