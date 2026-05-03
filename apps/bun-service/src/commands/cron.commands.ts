/**
 * RPC commands for cron jobs. Ported from
 * `crates/smartcrab-app/src-tauri/src/commands/cron.rs`.
 *
 * Until Unit 5 lands the SQLite layer, persistence is handled by an in-memory
 * store. The store is wired up via `setCronStore()` so Unit 7 stays
 * self-contained while integrating cleanly later.
 */
import {
  CronScheduler,
  type CronCallback,
  nextTick,
} from "../cron/scheduler";
import {
  type CronJob,
  type CronStore,
  InMemoryCronStore,
} from "../cron/runner";

let store: CronStore = new InMemoryCronStore();
let scheduler: CronScheduler = new CronScheduler();
let defaultCallback: (job: CronJob) => CronCallback = (job) => async () => {
  // No pipeline executor is wired yet (Unit 6). Just record the run.
  store.markRun(job.id, new Date().toISOString());
};

/** Replace the active store. Mainly for tests / runtime wiring. */
export function setCronStore(next: CronStore): void {
  store = next;
}

/** Replace the active scheduler. Mainly for tests / runtime wiring. */
export function setCronScheduler(next: CronScheduler): void {
  scheduler.shutdown();
  scheduler = next;
}

/** Override the callback that fires when a job ticks. */
export function setCronJobCallback(
  fn: (job: CronJob) => CronCallback,
): void {
  defaultCallback = fn;
}

function validate(expression: string): void {
  try {
    CronScheduler.validate(expression);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InvalidInputError(`invalid cron expression: ${msg}`);
  }
}

export class InvalidInputError extends Error {
  readonly code = "INVALID_INPUT";
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export interface CreateCronJobParams {
  pipeline_id: string;
  schedule: string;
}

export interface UpdateCronJobParams {
  id: string;
  schedule?: string;
  is_active?: boolean;
}

export interface IdParams {
  id: string;
}

export async function listCronJobs(): Promise<CronJob[]> {
  return store.list();
}

export async function createCronJob(
  params: CreateCronJobParams,
): Promise<CronJob> {
  validate(params.schedule);
  const now = new Date();
  const job: CronJob = {
    id: crypto.randomUUID(),
    pipeline_id: params.pipeline_id,
    schedule: params.schedule,
    is_active: true,
    last_run_at: null,
    next_run_at: nextTick(params.schedule, now).toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  store.insert(job);
  scheduler.schedule(job.id, job.schedule, defaultCallback(job));
  return job;
}

export async function updateCronJob(
  params: UpdateCronJobParams,
): Promise<CronJob> {
  if (params.schedule !== undefined) validate(params.schedule);
  const existing = store.get(params.id);
  if (!existing) {
    throw new NotFoundError(`cron job '${params.id}' not found`);
  }
  const merged: CronJob = {
    ...existing,
    schedule: params.schedule ?? existing.schedule,
    is_active: params.is_active ?? existing.is_active,
    updated_at: new Date().toISOString(),
  };
  store.update(merged);
  if (merged.is_active) {
    scheduler.schedule(merged.id, merged.schedule, defaultCallback(merged));
  } else {
    scheduler.unschedule(merged.id);
  }
  return merged;
}

export async function deleteCronJob(params: IdParams): Promise<void> {
  const removed = store.delete(params.id);
  if (!removed) {
    throw new NotFoundError(`cron job '${params.id}' not found`);
  }
  scheduler.unschedule(params.id);
}

export async function runCronJobNow(params: IdParams): Promise<void> {
  const existing = store.get(params.id);
  if (!existing) {
    throw new NotFoundError(`cron job '${params.id}' not found`);
  }
  // Ensure the scheduler knows about the job before running.
  if (scheduler.nextRunAt(params.id) === null) {
    scheduler.schedule(
      existing.id,
      existing.schedule,
      defaultCallback(existing),
    );
  }
  await scheduler.runNow(params.id);
  store.markRun(existing.id, new Date().toISOString());
}

/**
 * Default export: dispatcher map keyed by RPC method names.
 * Aligns with the dispatcher convention in Unit 4 (`server.ts` will glob-import
 * all `*.commands.ts` and merge their default exports).
 */
const handlers = {
  "cron.list": (_params: unknown) => listCronJobs(),
  "cron.create": (params: CreateCronJobParams) => createCronJob(params),
  "cron.update": (params: UpdateCronJobParams) => updateCronJob(params),
  "cron.delete": (params: IdParams) => deleteCronJob(params),
  "cron.run-now": (params: IdParams) => runCronJobNow(params),
} as const;

export type CronHandlers = typeof handlers;
export default handlers;
