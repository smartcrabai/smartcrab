/**
 * Translate the in-app SeherConfig (saved via `settings.app-save` from the
 * SwiftUI Settings tab) into the on-disk shape that `seher-ts` expects, and
 * write it to a fixed path so the SeherSDK in `router.ts` picks it up.
 *
 * Output path defaults to
 *   `$XDG_CONFIG_HOME/smartcrab/seher-settings.jsonc`
 * and is overridable through `SMARTCRAB_SEHER_CONFIG`.
 *
 * Schema reference: `apps/bun-service/node_modules/seher-ts/dist/types.d.ts`
 *   Settings { priority: PriorityRule[]; agents: AgentConfig[] }
 *   AgentConfig { command, args, models, arg_maps, env, provider, pre_command, active, inactive, sdk }
 *   PriorityRule { command, provider, model, priority, weekdays?, hours? }
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ProviderKind } from "@smartcrab/seher-config-schema";

import { configDir } from "../paths.ts";
import {
  isKimiBackedKind,
  kimiShareDirFor as kimiShareDirForProvider,
  writeKimiShare,
} from "./kimi-share.ts";

interface InAppProvider {
  id: string;
  kind: ProviderKind;
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
  return process.env.SMARTCRAB_SEHER_CONFIG || join(configDir(), "seher-settings.jsonc");
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
  sdk?: "claude" | "copilot" | "kimi" | null;
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

/**
 * `anthropic` and `openai` are SmartCrab UX-level kinds; both share the same
 * underlying CLI as `claude` / `kimi` respectively but with different config
 * (Anthropic-compatible base URL / OpenAI-compatible config.toml).
 */
interface KindInfo {
  readonly command: string;
  readonly providerName: string;
  readonly sdk: "claude" | "copilot" | "kimi";
}

const KIND_INFO: Record<ProviderKind, KindInfo> = {
  anthropic: { command: "claude",  providerName: "anthropic", sdk: "claude" },
  copilot:   { command: "copilot", providerName: "github",    sdk: "copilot" },
  kimi:      { command: "kimi",    providerName: "moonshot",  sdk: "kimi" },
  openai:    { command: "kimi",    providerName: "openai",    sdk: "kimi" },
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
    const info = KIND_INFO[provider.kind];
    if (!info) {
      // Persisted JSON predates the current ProviderKind union (e.g. legacy
      // `claude` / `codex`). Skip with a warning instead of crashing.
      console.warn(`[seher] dropping provider "${provider.id}" with unknown kind "${provider.kind}"`);
      continue;
    }

    // For kimi-backed kinds (kimi, openai) the spawned `kimi` CLI must read
    // SmartCrab's generated config.toml instead of the user's own
    // ~/.kimi/config.toml; the share dir holds that generated file (written
    // by writeSeherSettings).
    const env: Record<string, string> = { ...(provider.envOverrides ?? {}) };
    if (isKimiBackedKind(provider.kind) && env.KIMI_SHARE_DIR === undefined) {
      env.KIMI_SHARE_DIR = kimiShareDirForProvider(provider.id);
    }

    agents.push({
      command: info.command,
      args: [],
      models: provider.model ? { default: provider.model } : null,
      arg_maps: {},
      env: Object.keys(env).length > 0 ? env : null,
      provider: { kind: "explicit", name: info.providerName },
      pre_command: [],
      active: null,
      inactive: null,
      sdk: info.sdk,
    });

    const rules = rulesByProvider.get(provider.id) ?? [];
    for (const r of rules) {
      const weekdays = clampWeekdayRanges(r.weekdayFilter);
      const hours = hourRange(r.hourStart, r.hourEnd);
      priority.push({
        command: info.command,
        provider: { kind: "explicit", name: info.providerName },
        model: provider.model ?? null,
        priority: r.weight,
        ...(weekdays ? { weekdays } : {}),
        ...(hours ? { hours } : {}),
      });
    }
  }

  // Low-priority fallback row so the resolver always has a candidate even
  // when no per-provider rule fires.
  const fallbackId = cfg.defaults?.fallbackProviderId;
  if (fallbackId && knownProviderIds.has(fallbackId)) {
    const fallback = cfg.providers.find((p) => p.id === fallbackId)!;
    const info = KIND_INFO[fallback.kind];
    if (info && !priority.some((p) => p.command === info.command && p.priority === 0)) {
      priority.push({
        command: info.command,
        provider: { kind: "explicit", name: info.providerName },
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

  // Materialize the per-provider Kimi config.toml files first, so that if any
  // of them fail we don't leave seher-settings.jsonc pointing at share dirs
  // that don't exist yet. Each writeKimiShare is itself atomic (tmp+rename).
  for (const provider of cfg.providers) {
    if (!isKimiBackedKind(provider.kind)) continue;
    writeKimiShare({ providerId: provider.id, kind: provider.kind });
  }

  mkdirSync(dirname(path), { recursive: true });
  const banner =
    "// Generated by SmartCrab from the in-app Settings tab. Do not edit by hand —\n" +
    "// changes will be overwritten on the next `settings.app-save`.\n";
  writeFileSync(path, banner + JSON.stringify(settings, null, 2) + "\n", "utf8");
}
