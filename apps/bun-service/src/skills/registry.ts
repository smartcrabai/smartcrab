/**
 * In-memory skills registry, optionally backed by a SQL-ish DB.
 *
 * Ported from `crates/smartcrab-app/src-tauri/src/commands/skills.rs`:
 * - `list_skills_db`  -> `list()`
 * - `lookup_skill_db` -> `get(id)`
 * - `generate_skill_db` (DB write half) -> `save(skill)`
 * - `delete_skill_db` -> `delete(id)`
 * - `invoke_skill_db` -> `invoke(id, params, adapter)`
 *
 * The cache is the source of truth at runtime; the DB is treated as durable
 * storage. If a DB is provided, every mutation is mirrored to it. If no DB is
 * provided, the registry behaves as a pure in-memory store (useful for tests
 * and for the iOS Simulator preview target where bun:sqlite isn't available).
 */

import type {
  SkillInfo,
  SkillCreateInput,
  SkillInvocationResult,
  LlmAdapter,
} from "./types.ts";

/**
 * Minimal DB shape the registry depends on. Compatible with `bun:sqlite`'s
 * `Database` (Unit 5) without taking a hard import dependency on it.
 */
export interface SkillsDb {
  /** Run a parameterized statement that does not return rows. */
  run(sql: string, params?: unknown[]): void;
  /** Run a query and return all rows as plain objects. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
}

/** Row shape for the `skills` table (matches the Rust schema). */
interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  skill_type: string;
  pipeline_id: string | null;
  created_at: string;
  updated_at: string;
  body: string | null;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    file_path   TEXT NOT NULL,
    skill_type  TEXT NOT NULL,
    pipeline_id TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    body        TEXT
  )
`;

/** Options for constructing a registry. */
export interface SkillsRegistryOptions {
  /** Optional durable backing store. */
  db?: SkillsDb;
  /** Optional UUID factory (defaults to `crypto.randomUUID()`). */
  newId?: () => string;
  /** Optional clock (defaults to `() => new Date().toISOString()`). */
  now?: () => string;
}

export class SkillsRegistry {
  private readonly cache: Map<string, SkillInfo> = new Map();
  private readonly db?: SkillsDb;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(opts: SkillsRegistryOptions = {}) {
    this.db = opts.db;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.now = opts.now ?? (() => new Date().toISOString());

    if (this.db) {
      this.db.run(CREATE_TABLE_SQL);
      this.hydrateFromDb();
    }
  }

  /** Load all rows from the DB into the cache. Idempotent. */
  private hydrateFromDb(): void {
    if (!this.db) return;
    const rows = this.db.all<SkillRow>(
      "SELECT id, name, description, file_path, skill_type, pipeline_id, created_at, updated_at, body FROM skills",
    );
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.id, this.rowToSkill(row));
    }
  }

  private rowToSkill(row: SkillRow): SkillInfo {
    const skill: SkillInfo = {
      id: row.id,
      name: row.name,
      description: row.description,
      file_path: row.file_path,
      skill_type: row.skill_type,
      pipeline_id: row.pipeline_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (row.body != null) skill.body = row.body;
    return skill;
  }

  /** List all skills, sorted by `created_at` ascending. */
  list(): SkillInfo[] {
    return [...this.cache.values()].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }

  /** Get a skill by id, or `undefined` if not found. */
  get(id: string): SkillInfo | undefined {
    return this.cache.get(id);
  }

  /**
   * Persist a skill record (insert or upsert).
   *
   * If `skill.id` is empty, a new UUID is generated. `created_at` and
   * `updated_at` are set automatically when missing.
   */
  save(input: SkillCreateInput | SkillInfo): SkillInfo {
    const existing =
      "id" in input && input.id ? this.cache.get(input.id) : undefined;

    const id = existing?.id ?? this.newId();
    const now = this.now();
    const created_at = existing?.created_at ?? now;

    const skill: SkillInfo = {
      id,
      name: input.name,
      description: input.description ?? null,
      file_path: input.file_path ?? existing?.file_path ?? "",
      skill_type: input.skill_type ?? existing?.skill_type ?? "manual",
      pipeline_id: input.pipeline_id ?? existing?.pipeline_id ?? null,
      created_at,
      updated_at: now,
    };
    if ("body" in input && input.body != null) skill.body = input.body;
    else if (existing?.body != null) skill.body = existing.body;

    this.cache.set(id, skill);

    if (this.db) {
      this.db.run(
        `INSERT INTO skills (id, name, description, file_path, skill_type, pipeline_id, created_at, updated_at, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=excluded.description,
           file_path=excluded.file_path,
           skill_type=excluded.skill_type,
           pipeline_id=excluded.pipeline_id,
           updated_at=excluded.updated_at,
           body=excluded.body`,
        [
          skill.id,
          skill.name,
          skill.description,
          skill.file_path,
          skill.skill_type,
          skill.pipeline_id,
          skill.created_at,
          skill.updated_at,
          skill.body ?? null,
        ],
      );
    }

    return skill;
  }

  /**
   * Delete a skill by id.
   *
   * Returns `true` when a record was removed. Mirrors the Rust behaviour of
   * surfacing "not found" to the caller, but does not throw — the command
   * layer is responsible for translating to JSON-RPC errors.
   */
  delete(id: string): boolean {
    const had = this.cache.delete(id);
    if (this.db) {
      this.db.run("DELETE FROM skills WHERE id = ?", [id]);
    }
    return had;
  }

  /**
   * Invoke a skill against the supplied LLM adapter.
   *
   * Mirrors `invoke_skill_db`: looks up the skill, builds a prompt from the
   * skill body (or the `file_path` contents via `bodyResolver`), and forwards
   * to the adapter.
   */
  async invoke(
    id: string,
    input: unknown,
    adapter: LlmAdapter,
    bodyResolver?: (skill: SkillInfo) => Promise<string> | string,
  ): Promise<SkillInvocationResult> {
    const skill = this.cache.get(id);
    if (!skill) {
      throw new Error(`skill '${id}' not found`);
    }

    let body = skill.body ?? "";
    if (!body && bodyResolver) {
      body = await bodyResolver(skill);
    }

    const prompt = buildSkillPrompt(body, input);
    const response = await adapter.execute_prompt({ prompt });

    return {
      skill_id: skill.id,
      skill_name: skill.name,
      output: response.content,
    };
  }

  /** Replace the cache wholesale (used by `loader.merge`). */
  replaceAll(skills: SkillInfo[]): void {
    this.cache.clear();
    for (const skill of skills) {
      this.cache.set(skill.id, skill);
    }
  }
}

/**
 * Build the prompt sent to the LLM when invoking a skill. Mirrors
 * `build_skill_prompt` in the Rust source: string inputs are embedded raw,
 * everything else is pretty-printed JSON.
 */
export function buildSkillPrompt(skillBody: string, input: unknown): string {
  let inputStr: string;
  if (typeof input === "string") {
    inputStr = input;
  } else {
    try {
      inputStr = JSON.stringify(input, null, 2);
    } catch (e) {
      inputStr = `{"error":"Failed to serialize input: ${(e as Error).message}"}`;
    }
  }
  return `# Skill Definition\n\n${skillBody}\n\n---\n\n# User Input\n\n${inputStr}`;
}
