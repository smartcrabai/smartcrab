/**
 * smartcrab-specific provider configuration schema.
 *
 * The human-facing shape edited by the SwiftUI GUI. At runtime it is
 * converted through `translate()` into the seher-ts `settings.jsonc` form.
 */

/**
 * Which LLM implementation to use.
 * - `anthropic` ... Anthropic API compatible (driven by the Claude Agent SDK)
 * - `copilot`   ... GitHub Copilot (driven by the Copilot SDK)
 * - `kimi`      ... Moonshot Kimi (driven by the Kimi Agent SDK)
 * - `openai`    ... OpenAI API compatible (driven by the Kimi Agent SDK + Kimi CLI `openai_legacy`)
 */
export type ProviderKind = "anthropic" | "copilot" | "kimi" | "openai";

/** Weekday (0 = Sunday ... 6 = Saturday). Aligned with Date#getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Hour range [startHour, endHour). Both endpoints are integers in 0..24. */
export type HourRange = readonly [number, number];

/**
 * Declarative configuration for a single provider.
 * `id` is the logical name referenced by priority rules.
 */
export interface ProviderConfig {
  /** Unique logical name within smartcrab (referenced by priority.providerId). */
  readonly id: string;
  /** Adapter kind to use. */
  readonly kind: ProviderKind;
  /** Model name to use (falls back to the adapter default when omitted). */
  readonly model?: string;
  /** Extra environment variables injected when this provider is launched. */
  readonly envOverrides?: Readonly<Record<string, string>>;
}

/**
 * Provider priority rule. The seher-ts router picks providers by priority.
 *
 * Higher `weight` wins. When both `weekdays` and `hours` are specified they
 * are evaluated as an AND condition.
 */
export interface PriorityRule {
  /** Target provider id. Must correspond to a `ProviderConfig.id`. */
  readonly providerId: string;
  /** Priority weight (higher is picked first). Negative values are allowed. */
  readonly weight: number;
  /** Weekdays this rule is active. Omitted means "every weekday". */
  readonly weekdays?: readonly Weekday[];
  /** Time range this rule is active. Omitted means "all day". */
  readonly hours?: HourRange;
  /** Optional label string (for UI display). Not functional in translate -- not passed through. */
  readonly condition?: string;
}

/** Defaults for smartcrab-wide fallback behavior. */
export interface DefaultsConfig {
  /** Fallback used when no provider matches. */
  readonly fallbackProviderId: string;
  /** Back-off (in seconds) applied on rate-limit hits. */
  readonly rateLimitBackoffSec: number;
}

/** Root of the smartcrab configuration. The GUI edits this and writes it to disk as JSON. */
export interface SmartCrabConfig {
  readonly providers: readonly ProviderConfig[];
  readonly priority: readonly PriorityRule[];
  readonly defaults: DefaultsConfig;
}
