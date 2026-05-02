/**
 * Tests for the Unit 8 skills subsystem.
 *
 * Covers:
 * - `SkillsRegistry` CRUD with in-memory DB
 * - Disk loader + frontmatter parsing
 * - Auto-gen prompt + response parsing + end-to-end with mocked LLM
 * - Command surface dispatch
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SkillsRegistry,
  buildSkillPrompt,
  type SkillsDb,
} from "../skills/registry.ts";
import {
  autoGenerate,
  buildAutoGenPrompt,
  parseAutoGenResponse,
} from "../skills/auto-gen.ts";
import {
  loadFromDisk,
  mergeIntoRegistry,
  fileBodyResolver,
} from "../skills/loader.ts";
import type {
  ExecutionTrace,
  LlmAdapter,
  SkillInfo,
} from "../skills/types.ts";
import skillsCommands, {
  configureSkillsCommands,
  resetSkillsCommands,
} from "../commands/skills.commands.ts";

// ---------------------------------------------------------------------------
// In-memory DB fake
// ---------------------------------------------------------------------------

/**
 * Minimal SkillsDb implementation backed by a plain object map. Just enough
 * to exercise the registry's persistence path without pulling bun:sqlite into
 * unit tests.
 */
class FakeDb implements SkillsDb {
  rows: Map<string, Record<string, unknown>> = new Map();
  runs: Array<{ sql: string; params?: unknown[] }> = [];

  run(sql: string, params: unknown[] = []): void {
    this.runs.push({ sql, params });
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith("CREATE TABLE")) return;
    if (upper.startsWith("INSERT INTO SKILLS")) {
      const [
        id,
        name,
        description,
        file_path,
        skill_type,
        pipeline_id,
        created_at,
        updated_at,
        body,
      ] = params;
      this.rows.set(id as string, {
        id,
        name,
        description,
        file_path,
        skill_type,
        pipeline_id,
        created_at,
        updated_at,
        body,
      });
      return;
    }
    if (upper.startsWith("DELETE FROM SKILLS")) {
      this.rows.delete(params[0] as string);
      return;
    }
    throw new Error(`FakeDb: unhandled SQL: ${sql}`);
  }

  all<T = Record<string, unknown>>(_sql: string, _params?: unknown[]): T[] {
    return [...this.rows.values()] as T[];
  }
}

// ---------------------------------------------------------------------------
// Mock LLM
// ---------------------------------------------------------------------------

function makeMockLlm(content: string): LlmAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    async execute_prompt() {
      adapter.calls += 1;
      return { content };
    },
  };
  return adapter;
}

// ---------------------------------------------------------------------------
// Registry CRUD
// ---------------------------------------------------------------------------

describe("SkillsRegistry", () => {
  test("list() empty by default", () => {
    const r = new SkillsRegistry();
    expect(r.list()).toEqual([]);
  });

  test("save() assigns id, timestamps, and persists to DB", () => {
    const db = new FakeDb();
    const r = new SkillsRegistry({ db, newId: () => "id-1", now: () => "2026-01-01T00:00:00Z" });
    const skill = r.save({ name: "MySkill", description: "demo", body: "# hi" });
    expect(skill.id).toBe("id-1");
    expect(skill.created_at).toBe("2026-01-01T00:00:00Z");
    expect(skill.updated_at).toBe("2026-01-01T00:00:00Z");
    expect(db.rows.size).toBe(1);
    expect(db.rows.get("id-1")).toMatchObject({ name: "MySkill", body: "# hi" });
  });

  test("save() upserts when id matches", () => {
    const db = new FakeDb();
    let nowVal = "2026-01-01T00:00:00Z";
    const r = new SkillsRegistry({ db, newId: () => "id-1", now: () => nowVal });
    r.save({ name: "v1", body: "old" });
    nowVal = "2026-02-01T00:00:00Z";
    const updated = r.save({ id: "id-1", name: "v2", body: "new" } as SkillInfo);
    expect(updated.created_at).toBe("2026-01-01T00:00:00Z");
    expect(updated.updated_at).toBe("2026-02-01T00:00:00Z");
    expect(updated.name).toBe("v2");
    expect(r.list()).toHaveLength(1);
  });

  test("get() returns a stored skill", () => {
    const r = new SkillsRegistry({ newId: () => "id-1" });
    r.save({ name: "X" });
    expect(r.get("id-1")?.name).toBe("X");
    expect(r.get("missing")).toBeUndefined();
  });

  test("delete() removes from cache and DB", () => {
    const db = new FakeDb();
    const r = new SkillsRegistry({ db, newId: () => "id-1" });
    r.save({ name: "X" });
    expect(r.delete("id-1")).toBe(true);
    expect(r.list()).toEqual([]);
    expect(db.rows.size).toBe(0);
    expect(r.delete("id-1")).toBe(false);
  });

  test("invoke() builds prompt and forwards to adapter", async () => {
    const r = new SkillsRegistry({ newId: () => "id-1" });
    r.save({ name: "MySkill", body: "Do thing." });
    const llm = makeMockLlm("output");
    const result = await r.invoke("id-1", { topic: "rust" }, llm);
    expect(result).toEqual({ skill_id: "id-1", skill_name: "MySkill", output: "output" });
    expect(llm.calls).toBe(1);
  });

  test("invoke() throws for unknown skill", async () => {
    const r = new SkillsRegistry();
    await expect(r.invoke("nope", null, makeMockLlm("x"))).rejects.toThrow("not found");
  });

  test("hydrates existing rows from DB", () => {
    const db = new FakeDb();
    db.rows.set("preexisting", {
      id: "preexisting",
      name: "Old",
      description: null,
      file_path: "/tmp/x.md",
      skill_type: "manual",
      pipeline_id: null,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      body: "hi",
    });
    const r = new SkillsRegistry({ db });
    expect(r.list()).toHaveLength(1);
    expect(r.get("preexisting")?.body).toBe("hi");
  });
});

// ---------------------------------------------------------------------------
// buildSkillPrompt
// ---------------------------------------------------------------------------

describe("buildSkillPrompt", () => {
  test("string input is embedded raw", () => {
    const p = buildSkillPrompt("# Skill", "hello");
    expect(p).toContain("# Skill");
    expect(p).toContain("hello");
  });

  test("object input is JSON-stringified", () => {
    const p = buildSkillPrompt("# Skill", { topic: "rust", level: 42 });
    expect(p).toContain("\"topic\"");
    expect(p).toContain("\"rust\"");
    expect(p).toContain("42");
  });
});

// ---------------------------------------------------------------------------
// auto-gen
// ---------------------------------------------------------------------------

const TRACES: ExecutionTrace[] = [
  { timestamp: "2026-01-01T00:00:00Z", action: "chat.send", input: { msg: "a" }, output: "ok" },
  { timestamp: "2026-01-01T00:01:00Z", action: "chat.send", input: { msg: "b" }, output: "ok" },
];

describe("auto-gen", () => {
  test("buildAutoGenPrompt embeds traces as JSON", () => {
    const p = buildAutoGenPrompt(TRACES);
    expect(p).toContain("chat.send");
    expect(p).toContain("```json");
  });

  test("parseAutoGenResponse handles JSON-line + Markdown body", () => {
    const resp = `{"name":"EchoSkill","description":"Echo input"}\n# EchoSkill\n\nDo the thing.`;
    const parsed = parseAutoGenResponse(resp);
    expect(parsed.name).toBe("EchoSkill");
    expect(parsed.description).toBe("Echo input");
    expect(parsed.body).toContain("Do the thing.");
    expect(parsed.skill_type).toBe("auto-generated");
  });

  test("parseAutoGenResponse handles fenced ```json block", () => {
    const resp = "```json\n{\"name\":\"FencedSkill\",\"description\":\"d\"}\n```\n# Body\nhello";
    const parsed = parseAutoGenResponse(resp);
    expect(parsed.name).toBe("FencedSkill");
    expect(parsed.body).toContain("Body");
  });

  test("parseAutoGenResponse handles JSON-only", () => {
    const resp = `{"name":"MinSkill","description":"only meta"}`;
    const parsed = parseAutoGenResponse(resp);
    expect(parsed.name).toBe("MinSkill");
    expect(parsed.body).toBe("only meta");
  });

  test("parseAutoGenResponse falls back to body when JSON is absent", () => {
    const parsed = parseAutoGenResponse("just markdown");
    expect(parsed.name).toBe("auto-generated-skill");
    expect(parsed.body).toBe("just markdown");
  });

  test("autoGenerate end-to-end with mocked LLM", async () => {
    const llm = makeMockLlm(
      `{"name":"GenSkill","description":"gen"}\n# GenSkill\n\nSteps: 1. do it.`,
    );
    const skill = await autoGenerate(TRACES, llm);
    expect(skill.name).toBe("GenSkill");
    expect(skill.skill_type).toBe("auto-generated");
    expect(skill.body).toContain("Steps");
    expect(llm.calls).toBe(1);
  });

  test("autoGenerate throws on empty traces", async () => {
    await expect(autoGenerate([], makeMockLlm("x"))).rejects.toThrow("empty");
  });
});

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

describe("loader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smartcrab-skills-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("loadFromDisk parses frontmatter", async () => {
    await writeFile(
      join(dir, "echo.md"),
      `---\nname: Echo\ndescription: Repeat input\nskill_type: manual\n---\n\n# Echo\n\nBody`,
    );
    const skills = await loadFromDisk(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("Echo");
    expect(skills[0]?.description).toBe("Repeat input");
    expect(skills[0]?.skill_type).toBe("manual");
    expect(skills[0]?.body).toContain("# Echo");
  });

  test("loadFromDisk derives id/name from filename when missing", async () => {
    await writeFile(join(dir, "fallback.md"), `# Just markdown`);
    const skills = await loadFromDisk(dir);
    expect(skills[0]?.id).toBe("fallback");
    expect(skills[0]?.name).toBe("fallback");
  });

  test("loadFromDisk skips non-markdown files and missing dirs", async () => {
    await writeFile(join(dir, "notes.txt"), "ignored");
    expect(await loadFromDisk(dir)).toHaveLength(0);
    expect(await loadFromDisk(join(dir, "does-not-exist"))).toEqual([]);
  });

  test("mergeIntoRegistry replaces matching ids and keeps others", async () => {
    const r = new SkillsRegistry({ newId: () => "db-1" });
    r.save({ name: "DbOnly", body: "from db" });

    const fromDisk: SkillInfo[] = [
      {
        id: "disk-1",
        name: "DiskOne",
        description: null,
        file_path: "/tmp/disk-1.md",
        skill_type: "markdown",
        pipeline_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        body: "disk",
      },
    ];
    mergeIntoRegistry(r, fromDisk);
    const ids = r.list().map((s) => s.id).sort();
    expect(ids).toEqual(["db-1", "disk-1"]);
  });

  test("fileBodyResolver returns body when set, otherwise reads file", async () => {
    const filePath = join(dir, "body.md");
    await writeFile(filePath, `---\nname: B\n---\n\nfile contents`);

    const fromBody = await fileBodyResolver({
      id: "x",
      name: "X",
      description: null,
      file_path: "",
      skill_type: "manual",
      pipeline_id: null,
      created_at: "",
      updated_at: "",
      body: "inline",
    });
    expect(fromBody).toBe("inline");

    const fromFile = await fileBodyResolver({
      id: "y",
      name: "Y",
      description: null,
      file_path: filePath,
      skill_type: "markdown",
      pipeline_id: null,
      created_at: "",
      updated_at: "",
    });
    expect(fromFile).toContain("file contents");
  });
});

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

describe("skills.commands", () => {
  let llm: ReturnType<typeof makeMockLlm>;
  let registry: SkillsRegistry;

  beforeEach(() => {
    registry = new SkillsRegistry({ newId: (() => {
      let n = 0;
      return () => `cmd-${++n}`;
    })() });
    llm = makeMockLlm(`{"name":"Auto","description":"a"}\n# Auto\nbody`);
    configureSkillsCommands({
      registry,
      llm,
      traceProvider: () => TRACES,
    });
  });

  afterEach(() => resetSkillsCommands());

  test("skill.list / create / get / delete round-trip", async () => {
    expect(await skillsCommands["skill.list"]()).toEqual([]);

    const created = await skillsCommands["skill.create"]({ name: "Hand", body: "manual" });
    expect((created as SkillInfo).name).toBe("Hand");

    const got = await skillsCommands["skill.get"]({ id: (created as SkillInfo).id });
    expect((got as SkillInfo).name).toBe("Hand");

    const list = (await skillsCommands["skill.list"]()) as SkillInfo[];
    expect(list).toHaveLength(1);

    const del = await skillsCommands["skill.delete"]({ id: (created as SkillInfo).id });
    expect(del).toEqual({ ok: true });
    expect(await skillsCommands["skill.list"]()).toEqual([]);
  });

  test("skill.create requires name", async () => {
    await expect(skillsCommands["skill.create"]({})).rejects.toThrow("name");
  });

  test("skill.delete throws when missing", async () => {
    await expect(skillsCommands["skill.delete"]({ id: "missing" })).rejects.toThrow("not found");
  });

  test("skill.invoke calls the configured LLM", async () => {
    const created = (await skillsCommands["skill.create"]({
      name: "Echo",
      body: "Echo body",
    })) as SkillInfo;
    const result = (await skillsCommands["skill.invoke"]({
      id: created.id,
      input: "hello",
    })) as { output: string };
    expect(result.output).toContain("{");
    expect(llm.calls).toBe(1);
  });

  test("skill.auto-generate uses the trace provider and saves the skill", async () => {
    const result = (await skillsCommands["skill.auto-generate"]()) as SkillInfo;
    expect(result.name).toBe("Auto");
    expect(result.skill_type).toBe("auto-generated");
    expect((await skillsCommands["skill.list"]()) as SkillInfo[]).toHaveLength(1);
  });

  test("skill.auto-generate accepts inline traces", async () => {
    const result = (await skillsCommands["skill.auto-generate"]({
      traces: TRACES,
    })) as SkillInfo;
    expect(result.name).toBe("Auto");
  });
});

// ---------------------------------------------------------------------------
// Smoke test for default export shape
// ---------------------------------------------------------------------------

test("default export exposes all expected commands", () => {
  const keys = Object.keys(skillsCommands).sort();
  expect(keys).toContain("skill.list");
  expect(keys).toContain("skill.get");
  expect(keys).toContain("skill.create");
  expect(keys).toContain("skill.delete");
  expect(keys).toContain("skill.invoke");
  expect(keys).toContain("skill.auto-generate");
  expect(keys).toContain("skill.reload");
});

// Silence unused mock import warning (kept for future async stubbing).
void mock;
