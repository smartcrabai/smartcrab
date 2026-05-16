/**
 * TypeScript interfaces representing the seher-ts 0.1.13+ `config.yaml` shape
 * inside smartcrab.
 *
 * This file has no runtime dependency on the seher-ts library, so tests and
 * translators stay self-contained without external fetches.
 * The shape mirrors the `Config` / `ProviderEntry` from
 * `@seher-ts/sdk/types.ts`, covering only the surface that smartcrab uses.
 */

/** Canonical list of SDK kinds usable in seher-ts config.
 *  "kimi" is retained for seher-ts backward compatibility even though
 *  SmartCrab itself no longer ships a kimi adapter. */
export type SdkKind = "claude" | "codex" | "copilot" | "kimi" | "opencode" | "cursor" | "pi";

/** Per-mode model entry inside a provider entry. */
export interface SeherModelEntry {
  model: string;
  priority?: number;
}

/** API creds for a provider (forwarded to the underlying SDK). */
export interface SeherApi {
  key?: string;
  endpoint?: string;
}

/** A single provider in the YAML `providers` map. */
export interface SeherProviderEntry {
  /** Resolved provider name (defaults to the map key if omitted in YAML). */
  provider?: string;
  /** SDK kind to drive this provider with. */
  sdk?: SdkKind;
  /** Provider-level priority shorthand. */
  priority?: number;
  /** API creds forwarded to the SDK. */
  api?: SeherApi;
  /** Mode key -> model entry (e.g. build: { model: "gpt-4o" }). */
  models: Record<string, SeherModelEntry>;
}

/** Root of the seher-ts `config.yaml`. */
export interface SeherConfig {
  providers: Record<string, SeherProviderEntry>;
}
