/**
 * Module discovery shims.
 *
 * In dev / test mode (`bun run` and `bun test`), each `load*` function uses
 * `Bun.Glob` to scan the filesystem at runtime and dynamic-import every
 * matching module.
 *
 * In production builds (`bun run build`), `scripts/build.ts` registers a
 * Bun bundler plugin that replaces this entire file with one whose `load*`
 * functions return statically-imported modules. That makes the resulting
 * `bun build --compile` binary fully self-contained — no filesystem access
 * at startup — while still letting subsequent units add files without
 * editing any central registry.
 */

import { Glob } from "bun";
import { join } from "node:path";

import type { CommandMap } from "./types";

const ROOT = import.meta.dir;

async function scan(pattern: string): Promise<unknown[]> {
  const glob = new Glob(pattern);
  const modules: unknown[] = [];
  for await (const rel of glob.scan({ cwd: ROOT })) {
    const mod = await import(join(ROOT, rel));
    modules.push(mod);
  }
  return modules;
}

/** Discover and merge every `commands/*.commands.ts` default export. */
export async function loadCommandModules(): Promise<CommandMap> {
  const merged: CommandMap = {};
  const mods = await scan("./commands/*.commands.ts");
  for (const mod of mods) {
    const def = (mod as { default?: CommandMap }).default;
    if (def && typeof def === "object") Object.assign(merged, def);
  }
  return merged;
}

/** Side-effect import of every adapter under `adapters/llm/<name>/index.ts`. */
export async function loadLlmAdapters(): Promise<void> {
  await scan("./adapters/llm/*/index.ts");
}

/** Side-effect import of every adapter under `adapters/chat/<name>/index.ts`. */
export async function loadChatAdapters(): Promise<void> {
  await scan("./adapters/chat/*/index.ts");
}
