/**
 * Wires the in-process `CronScheduler` to the persisted `cron_jobs` table.
 *
 * The DB layer ships in Unit 5. Until that lands the runner uses
 * `InMemoryCronStore`. When the SQLite store arrives, swap in a
 * `SqliteCronStore` that implements `CronStore`.
 */
import { CronScheduler, type CronCallback } from "./scheduler";

export interface CronJob {
  id: string;
  pipeline_id: string;
  schedule: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CronStore {
  list(): CronJob[];
  get(id: string): CronJob | null;
  insert(job: CronJob): void;
  update(job: CronJob): void;
  delete(id: string): boolean;
  markRun(id: string, ranAt: string): void;
}

export class InMemoryCronStore implements CronStore {
  private readonly jobs = new Map<string, CronJob>();

  list(): CronJob[] {
    return [...this.jobs.values()].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }

  get(id: string): CronJob | null {
    return this.jobs.get(id) ?? null;
  }

  insert(job: CronJob): void {
    this.jobs.set(job.id, { ...job });
  }

  update(job: CronJob): void {
    if (!this.jobs.has(job.id)) {
      throw new Error(`cron job '${job.id}' not found`);
    }
    this.jobs.set(job.id, { ...job });
  }

  delete(id: string): boolean {
    return this.jobs.delete(id);
  }

  markRun(id: string, ranAt: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.last_run_at = ranAt;
    job.updated_at = ranAt;
  }
}

export interface RunnerOptions {
  store: CronStore;
  scheduler: CronScheduler;
  /** Callback factory invoked when a job is loaded or created. */
  callback: (job: CronJob) => CronCallback;
}

/**
 * Bootstrap the scheduler from a store snapshot. Call once at service start.
 */
export function bootstrapCronRunner(opts: RunnerOptions): void {
  for (const job of opts.store.list()) {
    if (!job.is_active) continue;
    opts.scheduler.schedule(job.id, job.schedule, opts.callback(job));
  }
}
