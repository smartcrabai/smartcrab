/**
 * seher-ts (https://github.com/smartcrabai/seher-ts) の `settings.jsonc` 形を
 * smartcrab 内で表す TypeScript インターフェイス。
 *
 * このファイルは seher-ts ライブラリへの runtime 依存を持たないため、
 * テストや translator は外部 fetch なしで完結する。
 * shape は seher-ts の README に基づき、smartcrab が利用する範囲だけを
 * 手書きで再現している (上位互換を意識し、追加プロパティは Record で受け流す前提)。
 */

/** seher-ts の曜日 (0 = Sunday … 6 = Saturday)。 */
export type SeherWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * seher の time-window: ある agent がアクティブな時間帯を表す。
 * `weekday` が空配列なら「全曜日」を意味するのが seher 側の規約。
 */
export interface SeherTimeWindow {
  readonly weekday: readonly SeherWeekday[];
  readonly startHour: number;
  readonly endHour: number;
}

/**
 * seher における 1 つの実行可能 agent。
 * 各 agent は単一の provider に紐づき、router によって weight 順に選ばれる。
 */
export interface SeherAgent {
  readonly name: string;
  readonly provider: string;
  readonly model?: string;
  readonly command?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeWindows?: readonly SeherTimeWindow[];
}

/** seher の優先度ルール。 */
export interface SeherPriorityRule {
  readonly agent: string;
  readonly weight: number;
}

/** seher-ts の `settings.jsonc` ルート。 */
export interface SeherSettings {
  readonly agents: readonly SeherAgent[];
  readonly priority: readonly SeherPriorityRule[];
}
