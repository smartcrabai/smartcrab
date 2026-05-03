/**
 * Unit 7 cron scheduler tests.
 *
 * Mirrors the Rust test suite from
 * `crates/smartcrab-app/src-tauri/src/commands/cron.rs` (the
 * `tests` mod) where applicable, plus scheduler-specific behavior.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  CronScheduler,
  nextTick,
} from "../cron/scheduler";
import {
  InMemoryCronStore,
  bootstrapCronRunner,
  type CronJob,
} from "../cron/runner";
import cronHandlers, {
  InvalidInputError,
  NotFoundError,
  createCronJob,
  deleteCronJob,
  listCronJobs,
  runCronJobNow,
  setCronJobCallback,
  setCronScheduler,
  setCronStore,
  updateCronJob,
} from "../commands/cron.commands";

function freshState() {
  const store = new InMemoryCronStore();
  const scheduler = new CronScheduler();
  setCronStore(store);
  setCronScheduler(scheduler);
  return { store, scheduler };
}

describe("cron expression parser", () => {
  test("parses 5-field every-minute", () => {
    const from = new Date("2026-01-01T00:00:30Z");
    const next = nextTick("* * * * *", from);
    // Next match is 00:01:00 UTC, but JS Date returns local-time fields when
    // calling getMinutes(); use getTime to compare absolute moment.
    expect(next.getTime()).toBe(new Date("2026-01-01T00:01:00Z").getTime());
  });

  test("parses 6-field expressions", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const next = nextTick("0 * * * * *", from);
    expect(next.getTime()).toBe(new Date("2026-01-01T00:01:00Z").getTime());
  });

  test("supports */N step", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const next = nextTick("*/15 * * * *", from);
    expect(next.getTime()).toBe(new Date("2026-01-01T00:15:00Z").getTime());
  });

  test("rejects bad field count", () => {
    expect(() => nextTick("not a cron", new Date())).toThrow();
  });

  test("rejects out-of-range values", () => {
    expect(() => nextTick("99 * * * *", new Date())).toThrow();
  });
});

describe("CronScheduler", () => {
  let scheduler: CronScheduler;

  afterEach(() => {
    scheduler?.shutdown();
  });

  test("schedules a job that fires within 200ms", async () => {
    scheduler = new CronScheduler();
    let fired = 0;
    let resolveFired: () => void = () => {};
    const fireOnce = new Promise<void>((res) => {
      resolveFired = res;
    });
    // We can't wait for an actual cron tick, so test runNow which is the
    // out-of-band path that wires through the same callback machinery.
    scheduler.schedule("job-a", "* * * * *", () => {
      fired++;
      resolveFired();
    });
    await Promise.race([
      scheduler.runNow("job-a"),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout")), 200)),
    ]);
    await Promise.race([
      fireOnce,
      new Promise((_r, rej) => setTimeout(() => rej(new Error("not fired")), 200)),
    ]);
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  test("schedule replaces existing job with same id", () => {
    scheduler = new CronScheduler();
    scheduler.schedule("dup", "* * * * *", () => {});
    scheduler.schedule("dup", "*/5 * * * *", () => {});
    expect(scheduler.size()).toBe(1);
  });

  test("unschedule cancels a job", () => {
    scheduler = new CronScheduler();
    scheduler.schedule("x", "* * * * *", () => {});
    expect(scheduler.unschedule("x")).toBe(true);
    expect(scheduler.size()).toBe(0);
    expect(scheduler.unschedule("x")).toBe(false);
  });

  test("runNow throws for unknown job", async () => {
    scheduler = new CronScheduler();
    await expect(scheduler.runNow("missing")).rejects.toThrow();
  });

  test("validate throws on invalid expression", () => {
    expect(() => CronScheduler.validate("nope")).toThrow();
  });

  test("nextRunAt is populated after scheduling", () => {
    scheduler = new CronScheduler();
    scheduler.schedule("y", "* * * * *", () => {});
    const next = scheduler.nextRunAt("y");
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  test("bootstrap runner registers active jobs only", () => {
    scheduler = new CronScheduler();
    const store = new InMemoryCronStore();
    const now = new Date().toISOString();
    const active: CronJob = {
      id: "a",
      pipeline_id: "p1",
      schedule: "* * * * *",
      is_active: true,
      last_run_at: null,
      next_run_at: null,
      created_at: now,
      updated_at: now,
    };
    const inactive: CronJob = { ...active, id: "b", is_active: false };
    store.insert(active);
    store.insert(inactive);
    bootstrapCronRunner({
      store,
      scheduler,
      callback: () => () => {},
    });
    expect(scheduler.size()).toBe(1);
    expect(scheduler.nextRunAt("a")).toBeInstanceOf(Date);
    expect(scheduler.nextRunAt("b")).toBeNull();
  });
});

describe("cron.commands handlers", () => {
  beforeEach(() => {
    freshState();
  });

  test("list is empty initially", async () => {
    expect(await listCronJobs()).toEqual([]);
  });

  test("create persists a job and schedules it", async () => {
    const job = await createCronJob({
      pipeline_id: "pipeline-1",
      schedule: "0 * * * * *",
    });
    expect(job.pipeline_id).toBe("pipeline-1");
    expect(job.schedule).toBe("0 * * * * *");
    expect(job.is_active).toBe(true);
    const list = await listCronJobs();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(job.id);
  });

  test("create rejects an invalid schedule", async () => {
    await expect(
      createCronJob({ pipeline_id: "p", schedule: "totally bogus" }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  test("update changes schedule", async () => {
    const job = await createCronJob({
      pipeline_id: "p",
      schedule: "0 * * * * *",
    });
    const updated = await updateCronJob({
      id: job.id,
      schedule: "0 0 * * * *",
    });
    expect(updated.schedule).toBe("0 0 * * * *");
    expect(updated.is_active).toBe(true);
  });

  test("update toggles active state", async () => {
    const job = await createCronJob({
      pipeline_id: "p",
      schedule: "0 * * * * *",
    });
    const updated = await updateCronJob({ id: job.id, is_active: false });
    expect(updated.is_active).toBe(false);
  });

  test("update on missing id throws NotFound", async () => {
    await expect(updateCronJob({ id: "nope" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("delete removes the job", async () => {
    const job = await createCronJob({
      pipeline_id: "p",
      schedule: "0 * * * * *",
    });
    await deleteCronJob({ id: job.id });
    expect(await listCronJobs()).toEqual([]);
  });

  test("delete on missing id throws NotFound", async () => {
    await expect(deleteCronJob({ id: "nope" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("run-now invokes the callback within 200ms", async () => {
    let fired = 0;
    let resolveFired: () => void = () => {};
    const done = new Promise<void>((res) => {
      resolveFired = res;
    });
    setCronJobCallback(() => async () => {
      fired++;
      resolveFired();
    });
    const job = await createCronJob({
      pipeline_id: "p",
      schedule: "0 * * * * *",
    });
    await Promise.race([
      runCronJobNow({ id: job.id }),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout")), 200)),
    ]);
    await Promise.race([
      done,
      new Promise((_r, rej) => setTimeout(() => rej(new Error("not fired")), 200)),
    ]);
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  test("default export exposes the dispatcher map", () => {
    expect(typeof cronHandlers["cron.list"]).toBe("function");
    expect(typeof cronHandlers["cron.create"]).toBe("function");
    expect(typeof cronHandlers["cron.update"]).toBe("function");
    expect(typeof cronHandlers["cron.delete"]).toBe("function");
    expect(typeof cronHandlers["cron.run-now"]).toBe("function");
  });
});
