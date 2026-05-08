/**
 * TypeScript interfaces representing the shape of seher-ts
 * (https://github.com/smartcrabai/seher-ts) `settings.jsonc` inside smartcrab.
 *
 * This file has no runtime dependency on the seher-ts library, so tests and
 * translators stay self-contained without external fetches.
 * The shape mirrors what is documented in the seher-ts README, covering only
 * the surface that smartcrab uses (forward-compatible by design: any extra
 * properties are accepted via Record and passed through).
 */

/** seher-ts weekday (0 = Sunday ... 6 = Saturday). */
export type SeherWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * seher time-window: the period during which an agent is active.
 * Per the seher-ts contract, an empty `weekday` array means "every weekday".
 */
export interface SeherTimeWindow {
  readonly weekday: readonly SeherWeekday[];
  readonly startHour: number;
  readonly endHour: number;
}

/**
 * A single executable agent in seher.
 * Each agent is bound to one provider; the router picks agents in weight order.
 */
export interface SeherAgent {
  readonly name: string;
  readonly provider: string;
  readonly model?: string;
  readonly command?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeWindows?: readonly SeherTimeWindow[];
}

/** seher priority rule. */
export interface SeherPriorityRule {
  readonly agent: string;
  readonly weight: number;
}

/** Root of the seher-ts `settings.jsonc`. */
export interface SeherSettings {
  readonly agents: readonly SeherAgent[];
  readonly priority: readonly SeherPriorityRule[];
}
