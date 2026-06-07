/**
 * TypeScript interfaces representing the seher `config.yaml` shape
 * inside smartcrab.
 *
 * This file has no runtime dependency on the seher library, so tests and
 * translators stay self-contained without external fetches.
 * The shape mirrors the `Config` / `ProviderEntry` consumed by the seher
 * config loader, covering only the surface that smartcrab uses.
 *
 * SmartCrab now only ever emits `sdk: pi` (pi_agent_rust in-process
 * execution); the wider union below is retained because the Rust seher loader
 * also accepts other (and even unknown) sdk strings, so there is no need to
 * narrow it.
 */

/** SDK kinds accepted by the seher config loader.
 *  SmartCrab itself only emits "pi"; the other members are kept for
 *  compatibility with configs produced elsewhere. */
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
