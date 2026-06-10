/**
 * End-to-end test for the SwiftUI Pipeline editor → Bun service → SQLite
 * round-trip. Mirrors the YAML shape `apps/macos/Sources/Pipelines/YAMLBridge.swift`
 * emits via `PipelineGraph.toYAML(...)` so this catches drift on either side.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCronJob, listCronJobs } from "../commands/cron.commands";
import handlers, { configurePipelineCommands } from "../commands/pipeline.commands";
import { openDb } from "../db";
import { SqlitePipelineDatabase } from "../db/pipelines";

describe("pipeline editor round-trip via SqlitePipelineDatabase", () => {
  let db: Database;

  beforeEach(() => {
    // openDb (not a bare new Database) so production pragmas — notably
    // foreign_keys = ON — apply to the test database too.
    db = openDb({ path: ":memory:" });
    configurePipelineCommands({
      db: new SqlitePipelineDatabase(db),
      deps: { fetch: globalThis.fetch },
    });
  });

  afterEach(() => {
    db.close();
  });

  const yamlFromSwiftUI = `name: my-pipeline
description: smoke
version: "1.0"
trigger:
  type: discord
nodes:
  - id: n1
    name: parse
  - id: n2
    name: respond
`;

  test("save → list → get returns the same yaml_content", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "my-pipeline",
      description: "smoke",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string; name: string; yaml_content: string };
    expect(saved.id).toBeTruthy();
    expect(saved.name).toBe("my-pipeline");

    const list = (await handlers["pipeline.list"]()) as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toContain(saved.id);

    const got = (await handlers["pipeline.get"]({ id: saved.id })) as {
      yaml_content: string;
      description: string | null;
    };
    expect(got.yaml_content).toBe(yamlFromSwiftUI);
    expect(got.description).toBe("smoke");
  });

  test("save with id upserts (re-save preserves id, updates name)", async () => {
    const first = (await handlers["pipeline.save"]({
      name: "v1",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };
    const second = (await handlers["pipeline.save"]({
      id: first.id,
      name: "v2",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string; name: string };
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("v2");
  });

  test("delete removes the row from list", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "tmp",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };
    await handlers["pipeline.delete"]({ id: saved.id });
    const list = (await handlers["pipeline.list"]()) as Array<{ id: string }>;
    expect(list.map((p) => p.id)).not.toContain(saved.id);
  });

  /** pipeline.execute runs in the background; poll until it finalizes and
   *  return the finalized history row. */
  async function waitForExecution(
    pipelineId: string,
    executionId: string,
  ): Promise<{ id: string; status: string; trigger_data: string | null }> {
    for (let i = 0; i < 100; i++) {
      const history = (await handlers["execution.history"]({
        pipeline_id: pipelineId,
      })) as Array<{ id: string; status: string; trigger_data: string | null }>;
      const row = history.find((e) => e.id === executionId);
      if (!row) throw new Error(`execution ${executionId} missing from history`);
      if (row.status !== "running") return row;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`execution ${executionId} did not finalize in time`);
  }

  test("execute persists execution logs readable via execution.logs and execution.detail", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "log-smoke",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    const { execution_id } = (await handlers["pipeline.execute"]({
      id: saved.id,
    })) as { execution_id: string };

    const finalized = await waitForExecution(saved.id, execution_id);
    expect(finalized.status).toBe("completed");

    const logs = (await handlers["execution.logs"]({
      execution_id,
    })) as Array<{ node_id: string | null; level: string; message: string }>;
    const messages = logs.map((l) => l.message);
    expect(messages).toContain("Execution started for pipeline 'my-pipeline'");
    expect(messages).toContain("Node 'parse' started (iteration 1)");
    expect(messages).toContain("Node 'respond' completed");
    expect(messages).toContain("Execution completed");
    expect(logs.filter((l) => l.node_id === "n1").length).toBe(2);

    const detail = (await handlers["execution.detail"]({
      execution_id,
    })) as {
      id: string;
      status: string;
      logs: unknown[];
      node_executions: unknown[];
    };
    expect(detail.id).toBe(execution_id);
    expect(detail.status).toBe("completed");
    expect(detail.logs.length).toBe(logs.length);
    expect(detail.node_executions).toEqual([]);
  });

  test("execution.history filters by pipeline_id and status, paginates with offset", async () => {
    const a = (await handlers["pipeline.save"]({
      name: "history-a",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };
    const b = (await handlers["pipeline.save"]({
      name: "history-b",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    // Insert finalized executions directly so started_at and status are
    // deterministic (pipeline.execute finalizes asynchronously).
    const insert = db.query(
      "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, status, started_at) VALUES (?1, ?2, 'manual', ?3, ?4)",
    );
    insert.run("ex-a1", a.id, "completed", 100);
    insert.run("ex-a2", a.id, "failed", 200);
    insert.run("ex-a3", a.id, "completed", 300);
    insert.run("ex-b1", b.id, "completed", 400);

    const forA = (await handlers["execution.history"]({
      pipeline_id: a.id,
    })) as Array<{ id: string }>;
    expect(forA.map((e) => e.id)).toEqual(["ex-a3", "ex-a2", "ex-a1"]);

    const failedA = (await handlers["execution.history"]({
      pipeline_id: a.id,
      status: "failed",
    })) as Array<{ id: string }>;
    expect(failedA.map((e) => e.id)).toEqual(["ex-a2"]);

    const page1 = (await handlers["execution.history"]({
      limit: 2,
    })) as Array<{ id: string }>;
    const page2 = (await handlers["execution.history"]({
      limit: 2,
      offset: 2,
    })) as Array<{ id: string }>;
    expect(page1.map((e) => e.id)).toEqual(["ex-b1", "ex-a3"]);
    expect(page2.map((e) => e.id)).toEqual(["ex-a2", "ex-a1"]);
  });

  test("pipeline.list reports the latest execution status per pipeline", async () => {
    const failing = (await handlers["pipeline.save"]({
      name: "status-failing",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };
    const healthy = (await handlers["pipeline.save"]({
      name: "status-healthy",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };
    const neverRan = (await handlers["pipeline.save"]({
      name: "status-never-ran",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    // Insert finalized executions directly so started_at and status are
    // deterministic. Same started_at on the failing pipeline exercises the
    // rowid tie-break: the later insert ("failed") must win.
    const insert = db.query(
      "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, status, started_at) VALUES (?1, ?2, 'manual', ?3, ?4)",
    );
    insert.run("st-f1", failing.id, "completed", 100);
    insert.run("st-f2", failing.id, "failed", 100);
    insert.run("st-h1", healthy.id, "failed", 100);
    insert.run("st-h2", healthy.id, "completed", 200);

    const list = (await handlers["pipeline.list"]()) as Array<{
      id: string;
      last_execution_status: string | null;
    }>;
    const byId = new Map(list.map((p) => [p.id, p.last_execution_status]));
    expect(byId.get(failing.id)).toBe("failed");
    expect(byId.get(healthy.id)).toBe("completed");
    expect(byId.get(neverRan.id)).toBeNull();
  });

  test("execution.detail rejects unknown execution ids", async () => {
    await expect(
      handlers["execution.detail"]({ execution_id: "nope" }),
    ).rejects.toThrow("not found");
  });

  test("delete succeeds for a pipeline with executions, logs, and cron jobs", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "delete-cascade",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    const { execution_id } = (await handlers["pipeline.execute"]({
      id: saved.id,
    })) as { execution_id: string };
    await waitForExecution(saved.id, execution_id);

    db.query(
      "INSERT INTO cron_jobs (id, pipeline_id, expression, enabled) VALUES ('cj-1', ?1, '* * * * *', 1)",
    ).run(saved.id);

    // foreign_keys = ON (via openDb): this used to fail with a FOREIGN KEY
    // constraint error because dependent rows were not removed first.
    await handlers["pipeline.delete"]({ id: saved.id });

    const list = (await handlers["pipeline.list"]()) as Array<{ id: string }>;
    expect(list.map((p) => p.id)).not.toContain(saved.id);
    const counts = db
      .query<{ executions: number; logs: number; crons: number }, [string, string]>(
        "SELECT (SELECT COUNT(*) FROM pipeline_executions WHERE pipeline_id = ?1) AS executions, (SELECT COUNT(*) FROM execution_logs WHERE execution_id = ?2) AS logs, (SELECT COUNT(*) FROM cron_jobs WHERE pipeline_id = ?1) AS crons",
      )
      .get(saved.id, execution_id);
    expect(counts).toEqual({ executions: 0, logs: 0, crons: 0 });
  });

  test("delete removes the pipeline's cron jobs from the cron command layer", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "delete-unschedules",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    const job = await createCronJob({
      pipeline_id: saved.id,
      schedule: "* * * * *",
    });
    expect((await listCronJobs()).map((j) => j.id)).toContain(job.id);

    await handlers["pipeline.delete"]({ id: saved.id });
    expect((await listCronJobs()).map((j) => j.id)).not.toContain(job.id);
  });

  test("execute rejects unknown trigger_type and non-string trigger_data", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "trigger-validation",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    await expect(
      handlers["pipeline.execute"]({ id: saved.id, trigger_type: "discord" }),
    ).rejects.toThrow("invalid trigger_type");
    await expect(
      handlers["pipeline.execute"]({
        id: saved.id,
        // Bypass the compile-time contract the way a misbehaving client would.
        trigger_data: { city: "tokyo" } as unknown as string,
      }),
    ).rejects.toThrow("JSON-encoded string");
  });

  test("execute stores trigger_data verbatim and honors trigger_type", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "trigger-data",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    const triggerData = '{"city":"tokyo"}';
    const { execution_id } = (await handlers["pipeline.execute"]({
      id: saved.id,
      trigger_type: "cron",
      trigger_data: triggerData,
    })) as { execution_id: string };

    const finalized = await waitForExecution(saved.id, execution_id);
    expect(finalized.status).toBe("completed");
    // Stored as-is — not double-encoded into "\"{\\\"city\\\":...\"".
    expect(finalized.trigger_data).toBe(triggerData);

    const detail = (await handlers["execution.detail"]({
      execution_id,
    })) as { trigger_type: string };
    expect(detail.trigger_type).toBe("cron");
  });
});
