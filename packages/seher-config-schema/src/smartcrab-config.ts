/**
 * smartcrab 独自のプロバイダ設定スキーマ。
 *
 * SwiftUI 側の GUI で編集される人間向けシェイプ。実行時に
 * `translate()` を通して seher-ts の `settings.jsonc` 形式に変換される。
 */

/** どの LLM 実装を使うかの種別。Adapter 自動登録のキーと一致する。 */
export type ProviderKind = "claude" | "kimi" | "copilot";

/** 曜日 (0 = Sunday … 6 = Saturday)。Date#getDay() に揃える。 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** [startHour, endHour) の時間レンジ。両端 0..24 の整数。 */
export type HourRange = readonly [number, number];

/**
 * 個別 provider の宣言的設定。
 * `id` は priority ルールから参照される論理名。
 */
export interface ProviderConfig {
  /** smartcrab 内で一意の論理名 (priority.providerId から参照される)。 */
  readonly id: string;
  /** 使用する adapter の種別。 */
  readonly kind: ProviderKind;
  /** 使用するモデル名 (省略時は adapter の default)。 */
  readonly model?: string;
  /** この provider 起動時に注入する追加環境変数。 */
  readonly envOverrides?: Readonly<Record<string, string>>;
}

/**
 * provider の優先順位ルール。seher-ts の router が同じ優先度を見て選ぶ。
 *
 * 重み (`weight`) が大きいほど優先される。
 * `weekdays` / `hours` を両方指定すると AND 条件で評価される。
 */
export interface PriorityRule {
  /** 対象 provider の id。`ProviderConfig.id` と対応していなければならない。 */
  readonly providerId: string;
  /** 優先度の重み (大きいほど先に選ばれる)。負値も許容。 */
  readonly weight: number;
  /** このルールが効く曜日の集合。未指定は「全曜日」。 */
  readonly weekdays?: readonly Weekday[];
  /** このルールが効く時間帯。未指定は「全日」。 */
  readonly hours?: HourRange;
  /** 任意のラベル文字列 (UI 表示用)。translate では非機能的 — pass-through しない。 */
  readonly condition?: string;
}

/** smartcrab 全体での fallback 動作の既定。 */
export interface DefaultsConfig {
  /** どの provider にも当てはまらない場合の fallback。 */
  readonly fallbackProviderId: string;
  /** rate-limit に当たった際の back-off (秒)。 */
  readonly rateLimitBackoffSec: number;
}

/** smartcrab 設定ルート。GUI が編集し、ディスクに JSON として書く。 */
export interface SmartCrabConfig {
  readonly providers: readonly ProviderConfig[];
  readonly priority: readonly PriorityRule[];
  readonly defaults: DefaultsConfig;
}
