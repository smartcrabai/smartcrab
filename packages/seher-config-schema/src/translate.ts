/**
 * Pure translation from the smartcrab-specific configuration into the
 * seher-ts `config.yaml` shape (providers map, seher-ts 0.1.13+).
 *
 * Performs no network calls, file I/O, or global-state access, so unit tests
 * reduce to golden comparisons.
 */

import type {
  PriorityRule,
  SmartCrabConfig,
} from "./smartcrab-config.ts";
import type {
  SeherApi,
  SeherConfig,
  SeherModelEntry,
  SeherProviderEntry,
} from "./seher-shape.ts";

/** Maps a SmartCrab ProviderKind to the seher-ts SDK kind. */
function toSdkKind(kind: string): string {
  switch (kind) {
    case "anthropic": return "claude";
    case "copilot":   return "copilot";
    case "openai":    return "pi";
    default:          return kind;
  }
}

/** Build api section from env overrides (OPENAI_API_KEY / OPENAI_BASE_URL). */
function buildApi(envOverrides?: Readonly<Record<string, string>>): SeherApi | undefined {
  if (!envOverrides) return undefined;
  const api: SeherApi = {};
  if (envOverrides.OPENAI_API_KEY) api.key = envOverrides.OPENAI_API_KEY;
  if (envOverrides.OPENAI_BASE_URL) api.endpoint = envOverrides.OPENAI_BASE_URL;
  return Object.keys(api).length > 0 ? api : undefined;
}

/** Format model id: pi-based providers need "openai/<model>" prefix. */
function buildModelId(kind: string, model?: string): string | undefined {
  if (model === undefined) return undefined;
  if (kind === "openai" && !model.includes("/")) {
    return `openai/${model}`;
  }
  return model;
}

/**
 * Pure translation from a smartcrab configuration into the seher-ts
 * `config.yaml` shape.
 *
 * Design notes:
 * - Each provider becomes a map entry with its id as the key.
 * - `model` is placed under `models.build`.
 * - `envOverrides` for openai providers map to `api.key` / `api.endpoint`.
 * - All other env vars are ignored (seher-ts 0.1.13 does not support generic
 *   env passthrough for pi, codex, copilot, cursor, or opencode SDKs).
 * - Priority rules map to per-provider `priority`.
 */
export function translate(cfg: SmartCrabConfig): SeherConfig {
  const providers: Record<string, SeherProviderEntry> = {};

  const maxWeights = new Map<string, number>();
  for (const rule of cfg.priority) {
    const prev = maxWeights.get(rule.providerId) ?? -Infinity;
    if (rule.weight > prev) maxWeights.set(rule.providerId, rule.weight);
  }

  for (const provider of cfg.providers) {
    const sdk = toSdkKind(provider.kind);
    const modelId = buildModelId(provider.kind, provider.model);
    const api = buildApi(provider.envOverrides);
    const maxWeight = maxWeights.get(provider.id);

    const models: Record<string, SeherModelEntry> = {};
    if (modelId) {
      models.build = { model: modelId };
    }

    const entry: SeherProviderEntry = {
      provider: provider.kind,
      sdk,
      models,
      ...(api && { api }),
      ...(maxWeight !== undefined && { priority: maxWeight }),
    };

    providers[provider.id] = entry;
  }

  return { providers };
}
