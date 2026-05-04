/**
 * End-to-end test for the SwiftUI Pipeline editor → Bun service → SQLite
 * round-trip. Mirrors the YAML shape `apps/macos/Sources/Pipelines/YAMLBridge.swift`
 * emits via `PipelineGraph.toYAML(...)` so this catches drift on either side.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import handlers, { configurePipelineCommands } from "../commands/pipeline.commands";
import { runMigrations } from "../db";
import { SqlitePipelineDatabase } from "../db/pipelines";

describe("pipeline editor round-trip via SqlitePipelineDatabase", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
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
});
