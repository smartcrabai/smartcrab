/**
 * In-memory cron scheduler.
 *
 * Manages a set of (jobId -> callback) entries and uses `setTimeout` to fire
 * each callback at the next scheduled tick computed from the cron expression.
 *
 * The scheduler tries to use `cron-parser` if it is installed; otherwise it
 * falls back to a small built-in parser that supports 5/6-field expressions
 * with `*`, exact integers, comma lists, ranges (`a-b`), and step (`*\/N`).
 * That covers the canonical `* * * * *` and the very common `*\/N` variants
 * exercised by the tests and by the original Rust port.
 */
export type CronCallback = () => void | Promise<void>;

export interface ScheduledJob {
  jobId: string;
  expression: string;
  callback: CronCallback;
  /** Reference to the underlying timer so we can cancel it. */
  timer: ReturnType<typeof setTimeout> | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
}

export interface CronSchedulerOptions {
  /** Override the wall-clock provider (used by tests). */
  now?: () => Date;
  /** Override `setTimeout`/`clearTimeout` (used by tests). */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class CronScheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly now: () => Date;
  private readonly setTimeoutFn: (
    cb: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (
    handle: ReturnType<typeof setTimeout>,
  ) => void;

  constructor(options: CronSchedulerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.setTimeoutFn =
      options.setTimeoutFn ??
      ((cb, ms) => setTimeout(cb, ms) as ReturnType<typeof setTimeout>);
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? ((h) => clearTimeout(h));
  }

  /** Validate a cron expression. Throws on invalid input. */
  static validate(expression: string): void {
    nextTick(expression, new Date());
  }

  /** Schedule a job. If the jobId already exists it is replaced. */
  schedule(jobId: string, expression: string, callback: CronCallback): void {
    CronScheduler.validate(expression);
    this.unschedule(jobId);
    const job: ScheduledJob = {
      jobId,
      expression,
      callback,
      timer: null,
      nextRunAt: null,
      lastRunAt: null,
    };
    this.jobs.set(jobId, job);
    this.armNext(job);
  }

  /** Cancel a scheduled job. No-op if it does not exist. */
  unschedule(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.timer) {
      this.clearTimeoutFn(job.timer);
      job.timer = null;
    }
    this.jobs.delete(jobId);
    return true;
  }

  /** Run a job's callback right now, out of band. Throws if unknown. */
  async runNow(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`cron job '${jobId}' not scheduled`);
    }
    job.lastRunAt = this.now();
    await job.callback();
  }

  /** Get the next planned run time for a scheduled job, or null. */
  nextRunAt(jobId: string): Date | null {
    return this.jobs.get(jobId)?.nextRunAt ?? null;
  }

  /** Get the last actual run time for a scheduled job, or null. */
  lastRunAt(jobId: string): Date | null {
    return this.jobs.get(jobId)?.lastRunAt ?? null;
  }

  /** Number of currently scheduled jobs. */
  size(): number {
    return this.jobs.size;
  }

  /** Cancel all scheduled jobs. */
  shutdown(): void {
    for (const id of [...this.jobs.keys()]) {
      this.unschedule(id);
    }
  }

  // -----------------------------------------------------------------------
  // private helpers
  // -----------------------------------------------------------------------

  private armNext(job: ScheduledJob): void {
    const fromTime = this.now();
    const next = nextTick(job.expression, fromTime);
    job.nextRunAt = next;
    const delay = Math.max(0, next.getTime() - fromTime.getTime());
    job.timer = this.setTimeoutFn(() => {
      void this.fire(job);
    }, delay);
  }

  private async fire(job: ScheduledJob): Promise<void> {
    // Job may have been unscheduled while waiting.
    if (!this.jobs.has(job.jobId)) return;
    job.lastRunAt = this.now();
    try {
      await job.callback();
    } catch (err) {
      // Callbacks should not crash the scheduler; surface to stderr.
      // eslint-disable-next-line no-console
      console.error(`[cron] job '${job.jobId}' failed:`, err);
    }
    // Rearm if still scheduled.
    if (this.jobs.has(job.jobId)) {
      this.armNext(job);
    }
  }
}

// ---------------------------------------------------------------------------
// Cron expression evaluation
// ---------------------------------------------------------------------------

/**
 * Compute the next time after `from` (exclusive) that matches `expression`.
 *
 * Tries `cron-parser` if available, then falls back to a built-in parser.
 */
export function nextTick(expression: string, from: Date): Date {
  try {
    // Lazy require so missing dep does not break the module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = tryRequire("cron-parser");
    if (mod && typeof mod.parseExpression === "function") {
      const interval = mod.parseExpression(expression, { currentDate: from });
      const next = interval.next();
      // cron-parser returns a CronDate; toDate() yields a JS Date.
      return typeof next.toDate === "function" ? next.toDate() : new Date(next);
    }
  } catch {
    // Fall through to inline parser.
  }
  return inlineNextTick(expression, from);
}

function tryRequire(name: string): any {
  try {
    // Bun and Node both support createRequire; use dynamic Function to avoid
    // bundlers attempting to resolve at build time.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const req = new Function("m", "return require(m)") as (m: string) => any;
    return req(name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline cron parser (5- or 6-field) — sufficient for tests and common usage.
// Field order (5-field):  minute hour day-of-month month day-of-week
// Field order (6-field):  second minute hour day-of-month month day-of-week
// Supported tokens: '*'  N  N-M  *\/N  N-M/N  comma-separated list of those.
// Day-of-week: 0-6 (Sun=0 or 7).  Month: 1-12.
// ---------------------------------------------------------------------------

interface ParsedCron {
  seconds: number[];
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function inlineNextTick(expression: string, from: Date): Date {
  const parsed = parseExpression(expression);
  // Start from the next second after `from`.
  const start = new Date(from.getTime());
  start.setMilliseconds(0);
  start.setSeconds(start.getSeconds() + 1);

  // Cap iteration to avoid infinite loop on impossible expressions.
  // 4 years of seconds is plenty for any reasonable cron.
  const maxIter = 4 * 366 * 24 * 60 * 60;
  const cur = new Date(start.getTime());
  for (let i = 0; i < maxIter; i++) {
    if (matches(parsed, cur)) return cur;
    cur.setSeconds(cur.getSeconds() + 1);
  }
  throw new Error(`cron expression '${expression}' has no matching tick`);
}

function matches(p: ParsedCron, d: Date): boolean {
  return (
    p.seconds.includes(d.getSeconds()) &&
    p.minutes.includes(d.getMinutes()) &&
    p.hours.includes(d.getHours()) &&
    p.daysOfMonth.includes(d.getDate()) &&
    p.months.includes(d.getMonth() + 1) &&
    p.daysOfWeek.includes(d.getDay())
  );
}

function parseExpression(expression: string): ParsedCron {
  const trimmed = expression.trim();
  if (!trimmed) throw new Error("invalid cron expression: empty");
  const fields = trimmed.split(/\s+/);
  let seconds: string;
  let minutes: string;
  let hours: string;
  let dom: string;
  let month: string;
  let dow: string;
  if (fields.length === 5) {
    seconds = "0";
    [minutes, hours, dom, month, dow] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
  } else if (fields.length === 6) {
    [seconds, minutes, hours, dom, month, dow] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
  } else {
    throw new Error(
      `invalid cron expression: expected 5 or 6 fields, got ${fields.length}`,
    );
  }

  return {
    seconds: parseField(seconds, 0, 59),
    minutes: parseField(minutes, 0, 59),
    hours: parseField(hours, 0, 23),
    daysOfMonth: parseField(dom, 1, 31),
    months: parseField(month, 1, 12),
    daysOfWeek: parseDayOfWeek(dow),
  };
}

function parseDayOfWeek(field: string): number[] {
  // Allow Sun=7 and normalize to 0.
  const expanded = parseField(field, 0, 7);
  const set = new Set<number>();
  for (const v of expanded) set.add(v === 7 ? 0 : v);
  return [...set].sort((a, b) => a - b);
}

function parseField(field: string, min: number, max: number): number[] {
  const parts = field.split(",");
  const out = new Set<number>();
  for (const part of parts) {
    for (const v of parsePart(part, min, max)) out.add(v);
  }
  if (out.size === 0) {
    throw new Error(`invalid cron expression: empty field`);
  }
  return [...out].sort((a, b) => a - b);
}

function parsePart(part: string, min: number, max: number): number[] {
  // Step?  '*\/N' or 'a-b/N' or 'N/M' (treated as N-max/M)
  const stepIdx = part.indexOf("/");
  let base = part;
  let step = 1;
  if (stepIdx !== -1) {
    base = part.slice(0, stepIdx);
    const stepStr = part.slice(stepIdx + 1);
    const stepNum = Number(stepStr);
    if (!Number.isInteger(stepNum) || stepNum <= 0) {
      throw new Error(`invalid cron expression: bad step '${stepStr}'`);
    }
    step = stepNum;
  }

  let lo: number;
  let hi: number;
  if (base === "*" || base === "") {
    lo = min;
    hi = max;
  } else if (base.includes("-")) {
    const [a, b] = base.split("-");
    lo = Number(a);
    hi = Number(b);
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error(`invalid cron expression: bad range '${base}'`);
    }
  } else {
    const v = Number(base);
    if (!Number.isInteger(v)) {
      throw new Error(`invalid cron expression: '${base}' is not an integer`);
    }
    if (stepIdx !== -1) {
      // 'N/M' means start at N, step M, up to max.
      lo = v;
      hi = max;
    } else {
      lo = v;
      hi = v;
    }
  }

  if (lo < min || hi > max || lo > hi) {
    throw new Error(
      `invalid cron expression: ${base} out of range ${min}-${max}`,
    );
  }
  const out: number[] = [];
  for (let i = lo; i <= hi; i += step) out.push(i);
  return out;
}
