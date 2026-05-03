/**
 * On-disk skills loader.
 *
 * Reads markdown files from the user's skills directory (default
 * `~/Library/Application Support/SmartCrab/skills/*.md`) and parses
 * frontmatter via `gray-matter`. Records the result as `SkillInfo`
 * structures so they can be merged into the registry alongside DB-backed
 * skills.
 *
 * Frontmatter keys (all optional):
 *   id, name, description, skill_type, pipeline_id, created_at, updated_at
 *
 * Missing `id` is derived from the file basename, missing `name` from `id`,
 * and missing timestamps default to the current time.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import matter from "gray-matter";

import type { SkillInfo } from "./types.ts";
import type { SkillsRegistry } from "./registry.ts";

/** Default skills directory used when no override is supplied. */
export function defaultSkillsDir(): string {
  return join(homedir(), "Library", "Application Support", "SmartCrab", "skills");
}

/**
 * Load skills from a directory of markdown files. Returns an empty array if
 * the directory does not exist (matches Tauri's tolerant behaviour).
 */
export async function loadFromDisk(dir?: string): Promise<SkillInfo[]> {
  const root = dir ?? defaultSkillsDir();

  let entries: string[];
  try {
    const s = await stat(root);
    if (!s.isDirectory()) return [];
    entries = await readdir(root);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== ".md") continue;
    const path = join(root, entry);
    try {
      const raw = await readFile(path, "utf8");
      const parsed = matter(raw);
      const data = parsed.data as Partial<SkillInfo> & {
        id?: string;
        name?: string;
      };
      const baseId = entry.replace(/\.md$/i, "");
      const now = new Date().toISOString();
      skills.push({
        id: data.id ?? baseId,
        name: data.name ?? baseId,
        description: data.description ?? null,
        file_path: path,
        skill_type: data.skill_type ?? "markdown",
        pipeline_id: data.pipeline_id ?? null,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
        body: parsed.content,
      });
    } catch {
      // Skip unreadable / malformed files; one bad file shouldn't block the rest.
    }
  }
  return skills;
}

/**
 * Merge a list of disk-loaded skills into a registry.
 *
 * On-disk entries win when they share an id with an existing record (since
 * the user authored the markdown file directly). DB-only entries are kept.
 */
export function mergeIntoRegistry(
  registry: SkillsRegistry,
  fromDisk: SkillInfo[],
): void {
  const existing = new Map(registry.list().map((s) => [s.id, s] as const));
  for (const disk of fromDisk) {
    existing.set(disk.id, disk);
  }
  registry.replaceAll([...existing.values()]);
}

/** Resolve a skill body by reading its `file_path`, used by the registry. */
export async function fileBodyResolver(skill: SkillInfo): Promise<string> {
  if (skill.body) return skill.body;
  if (!skill.file_path) return "";
  try {
    const raw = await readFile(skill.file_path, "utf8");
    return matter(raw).content;
  } catch {
    return "";
  }
}
