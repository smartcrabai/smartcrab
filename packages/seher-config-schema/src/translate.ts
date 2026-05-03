/**
 * smartcrab の独自設定 → seher-ts `settings.jsonc` 形への純粋変換。
 *
 * ネットワーク・ファイル I/O・グローバル状態を一切持たないため、
 * 単体テストはゴールデン比較だけで済む。
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
 * smartcrab 設定 → seher-ts `settings.jsonc` 形への純粋変換。
 *
 * 設計メモ:
 * - 同一 provider に複数 priority ルールがある場合、weight は最大値を採用
 *   (seher の router は agent ごとに 1 つの weight しか読まない)。
 * - 未知 provider を参照する priority ルールは黙って無視
 *   (UI 側でバリデーションする前提だが translator は防御的に振る舞う)。
 * - fallback provider が priority に含まれない場合は weight=0 で補う。
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
 * weekdays / hours が両方 undefined なルールは「常時有効」を意味するため
 * seher 側では time-window 自体を持たない (null を返す)。
 *
 * smartcrab の `Weekday` と seher の `SeherWeekday` は値域 (0..6) が同一なので
 * `weekdays` 配列はそのまま再利用できる。
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
