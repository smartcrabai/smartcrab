/**
 * End-to-end test for the SwiftUI Pipeline editor → Bun service → SQLite
 * round-trip. Mirrors the YAML shape `apps/macos/Sources/Pipelines/YAMLBridge.swift`
 * emits via `PipelineGraph.toYAML(...)` so this catches drift on either side.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

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

  test("execute persists execution logs readable via execution.logs and execution.detail", async () => {
    const saved = (await handlers["pipeline.save"]({
      name: "log-smoke",
      yaml_content: yamlFromSwiftUI,
    })) as { id: string };

    const { execution_id } = (await handlers["pipeline.execute"]({
      id: saved.id,
    })) as { execution_id: string };

    // pipeline.execute runs in the background; poll until it finalizes.
    let status = "running";
    for (let i = 0; i < 100 && status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const history = (await handlers["execution.history"]({
        pipeline_id: saved.id,
      })) as Array<{ id: string; status: string }>;
      const row = history.find((e) => e.id === execution_id);
      if (!row) throw new Error(`execution ${execution_id} missing from history`);
      status = row.status;
    }
    expect(status).toBe("completed");

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

  test("execution.detail rejects unknown execution ids", async () => {
    await expect(
      handlers["execution.detail"]({ execution_id: "nope" }),
    ).rejects.toThrow("not found");
  });
});
