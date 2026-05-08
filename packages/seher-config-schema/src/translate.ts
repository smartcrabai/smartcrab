/**
 * Pure translation from the smartcrab-specific configuration into the
 * seher-ts `settings.jsonc` shape.
 *
 * Performs no network calls, file I/O, or global-state access, so unit tests
 * reduce to golden comparisons.
 */

import type {
  PriorityRule,
  SmartCrabConfig,
} from "./smartcrab-config.ts";
import type {
  SeherAgent,
  SeherPriorityRule,
  SeherSettings,
  SeherTimeWindow,
} from "./seher-shape.ts";

/**
 * Pure translation from a smartcrab configuration into the seher-ts
 * `settings.jsonc` shape.
 *
 * Design notes:
 * - When multiple priority rules target the same provider, the maximum
 *   weight wins (seher's router reads exactly one weight per agent).
 * - Priority rules referencing an unknown provider are silently dropped
 *   (the UI is expected to validate; the translator stays defensive).
 * - If the fallback provider is missing from priority, it is appended with
 *   weight=0.
 */
export function translate(cfg: SmartCrabConfig): SeherSettings {
  const knownProviderIds = new Set(cfg.providers.map((p) => p.id));

  const rulesByProvider = new Map<string, PriorityRule[]>();
  for (const rule of cfg.priority) {
    if (!knownProviderIds.has(rule.providerId)) continue;
    const list = rulesByProvider.get(rule.providerId);
    if (list) list.push(rule);
    else rulesByProvider.set(rule.providerId, [rule]);
  }

  const agents: SeherAgent[] = [];
  const priority: SeherPriorityRule[] = [];

  for (const provider of cfg.providers) {
    const rules = rulesByProvider.get(provider.id) ?? [];
    const timeWindows = rules
      .map(ruleToTimeWindow)
      .filter((w): w is SeherTimeWindow => w !== null);
    const env = provider.envOverrides;

    agents.push({
      name: provider.id,
      provider: provider.kind,
      ...(provider.model !== undefined && { model: provider.model }),
      ...(env && Object.keys(env).length > 0 && { env: { ...env } }),
      ...(timeWindows.length > 0 && { timeWindows }),
    });

    if (rules.length > 0) {
      priority.push({
        agent: provider.id,
        weight: Math.max(...rules.map((r) => r.weight)),
      });
    }
  }

  const fallbackId = cfg.defaults.fallbackProviderId;
  if (
    knownProviderIds.has(fallbackId) &&
    !priority.some((p) => p.agent === fallbackId)
  ) {
    priority.push({ agent: fallbackId, weight: 0 });
  }

  return { agents, priority };
}

/**
 * A rule with both `weekdays` and `hours` undefined means "always active",
 * so it has no time-window on the seher side (we return null).
 *
 * smartcrab's `Weekday` and seher's `SeherWeekday` share the same value
 * domain (0..6), so the `weekdays` array can be reused as-is.
 */
function ruleToTimeWindow(rule: PriorityRule): SeherTimeWindow | null {
  if (rule.weekdays === undefined && rule.hours === undefined) return null;
  const [startHour, endHour] = rule.hours ?? [0, 24];
  return {
    weekday: rule.weekdays ?? [],
    startHour,
    endHour,
  };
}
