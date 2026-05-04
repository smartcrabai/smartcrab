/**
 * Translate the in-app SeherConfig (saved via `settings.app-save` from the
 * SwiftUI Settings tab) into the on-disk shape that `seher-ts` expects, and
 * write it to a fixed path so the SeherSDK in `router.ts` picks it up.
 *
 * Output path defaults to
 *   `~/Library/Application Support/SmartCrab/seher-settings.jsonc`
 * and is overridable through `SMARTCRAB_SEHER_CONFIG`.
 *
 * Schema reference: `apps/bun-service/node_modules/seher-ts/dist/types.d.ts`
 *   Settings { priority: PriorityRule[]; agents: AgentConfig[] }
 *   AgentConfig { command, args, models, arg_maps, env, provider, pre_command, active, inactive, sdk }
 *   PriorityRule { command, provider, model, priority, weekdays?, hours? }
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface InAppProvider {
  id: string;
  /** "claude" | "kimi" | "copilot" */
  kind: string;
  model: string;
  envOverrides?: Record<string, string>;
}

interface InAppPriorityRule {
  providerId: string;
  weight: number;
  /** 0=Sun .. 6=Sat */
  weekdayFilter?: number[];
  hourStart?: number;
  hourEnd?: number;
  condition?: string;
}

interface InAppDefaults {
  fallbackProviderId: string;
  rateLimitBackoffSeconds: number;
}

export interface InAppSeherConfig {
  providers: InAppProvider[];
  priorities: InAppPriorityRule[];
  defaults: InAppDefaults;
}

export function defaultSeherConfigPath(): string {
  return (
    process.env.SMARTCRAB_SEHER_CONFIG ??
    join(homedir(), "Library", "Application Support", "SmartCrab", "seher-settings.jsonc")
  );
}

interface SeherAgent {
  command: string;
  args: string[];
  models: Record<string, string> | null;
  arg_maps: Record<string, string[]>;
  env: Record<string, string> | null;
  provider: { kind: "explicit"; name: string } | { kind: "inferred" };
  pre_command: string[];
  active: { weekdays?: string[]; hours?: string[] } | null;
  inactive: { weekdays?: string[]; hours?: string[] } | null;
  sdk?: "claude" | "codex" | "copilot" | "kimi" | null;
}

interface SeherPriorityRule {
  command: string;
  provider: { kind: "explicit"; name: string } | { kind: "inferred" };
  model: string | null;
  priority: number;
  weekdays?: string[];
  hours?: string[];
}

interface SeherSettings {
  agents: SeherAgent[];
  priority: SeherPriorityRule[];
}

const KIND_TO_COMMAND: Record<string, string> = {
  claude: "claude",
  kimi: "kimi",
  copilot: "copilot",
  codex: "codex",
};

const KIND_TO_PROVIDER_NAME: Record<string, string> = {
  claude: "anthropic",
  kimi: "moonshot",
  copilot: "github",
  codex: "openai",
};

const KIND_TO_SDK: Record<string, "claude" | "codex" | "copilot" | "kimi"> = {
  claude: "claude",
  kimi: "kimi",
  copilot: "copilot",
  codex: "codex",
};

function clampWeekdayRanges(weekdays: number[] | undefined): string[] | undefined {
  if (!weekdays || weekdays.length === 0) return undefined;
  const sorted = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  // Compact consecutive numbers into "start-end" ranges.
  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = cur;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges;
}

function hourRange(start: number | undefined, end: number | undefined): string[] | undefined {
  if (start === undefined || end === undefined) return undefined;
  if (start === 0 && end === 24) return undefined; // covers full day; omit
  return [`${start}-${end}`];
}

export function translateToSeherSettings(cfg: InAppSeherConfig): SeherSettings {
  const knownProviderIds = new Set(cfg.providers.map((p) => p.id));

  const rulesByProvider = new Map<string, InAppPriorityRule[]>();
  for (const rule of cfg.priorities ?? []) {
    if (!knownProviderIds.has(rule.providerId)) continue;
    const list = rulesByProvider.get(rule.providerId);
    if (list) list.push(rule);
    else rulesByProvider.set(rule.providerId, [rule]);
  }

  const agents: SeherAgent[] = [];
  const priority: SeherPriorityRule[] = [];

  for (const provider of cfg.providers) {
    const command = KIND_TO_COMMAND[provider.kind] ?? provider.kind;
    const providerName = KIND_TO_PROVIDER_NAME[provider.kind];
    const sdk = KIND_TO_SDK[provider.kind] ?? null;

    agents.push({
      command,
      args: [],
      models: provider.model ? { default: provider.model } : null,
      arg_maps: {},
      env:
        provider.envOverrides && Object.keys(provider.envOverrides).length > 0
          ? { ...provider.envOverrides }
          : null,
      provider: providerName ? { kind: "explicit", name: providerName } : { kind: "inferred" },
      pre_command: [],
      active: null,
      inactive: null,
      sdk,
    });

    const rules = rulesByProvider.get(provider.id) ?? [];
    for (const r of rules) {
      const weekdays = clampWeekdayRanges(r.weekdayFilter);
      const hours = hourRange(r.hourStart, r.hourEnd);
      priority.push({
        command,
        provider: providerName ? { kind: "explicit", name: providerName } : { kind: "inferred" },
        model: provider.model ?? null,
        priority: r.weight,
        ...(weekdays ? { weekdays } : {}),
        ...(hours ? { hours } : {}),
      });
    }
  }

  // Append a low-priority fallback row so the resolver always has a candidate
  // even when no per-provider rule fires.
  const fallbackId = cfg.defaults?.fallbackProviderId;
  if (fallbackId && knownProviderIds.has(fallbackId)) {
    const fallback = cfg.providers.find((p) => p.id === fallbackId)!;
    const command = KIND_TO_COMMAND[fallback.kind] ?? fallback.kind;
    const providerName = KIND_TO_PROVIDER_NAME[fallback.kind];
    if (!priority.some((p) => p.command === command && p.priority === 0)) {
      priority.push({
        command,
        provider: providerName ? { kind: "explicit", name: providerName } : { kind: "inferred" },
        model: fallback.model ?? null,
        priority: 0,
      });
    }
  }

  return { agents, priority };
}

/** Write the translated settings file. Creates parent dirs as needed. */
export function writeSeherSettings(cfg: InAppSeherConfig, path: string = defaultSeherConfigPath()): void {
  const settings = translateToSeherSettings(cfg);
  mkdirSync(dirname(path), { recursive: true });
  const banner =
    "// Generated by SmartCrab from the in-app Settings tab. Do not edit by hand —\n" +
    "// changes will be overwritten on the next `settings.app-save`.\n";
  writeFileSync(path, banner + JSON.stringify(settings, null, 2) + "\n", "utf8");
}
