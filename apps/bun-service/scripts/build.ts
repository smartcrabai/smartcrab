/**
 * Production build for the bun-service.
 *
 * Replaces `src/_loaders.ts` at bundle time with a static-imports version,
 * then compiles a single self-contained binary. Subsequent units only need
 * to drop new files into `src/commands/`, `src/adapters/llm/<name>/`, or
 * `src/adapters/chat/<name>/` — no central registry edits required.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function listCommandFiles(): string[] {
  const dir = join(SRC, "commands");
  if (!exists(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".commands.ts"))
    .sort();
}

function listAdapterIndexes(kind: "llm" | "chat"): string[] {
  const dir = join(SRC, "adapters", kind);
  if (!exists(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const candidate = join(dir, name, "index.ts");
    if (exists(candidate)) {
      out.push(relative(SRC, candidate));
    }
  }
  return out;
}

function buildLoadersStub(): string {
  const cmdFiles = listCommandFiles();
  const llmFiles = listAdapterIndexes("llm");
  const chatFiles = listAdapterIndexes("chat");

  const cmdImports = cmdFiles
    .map((f, i) => `import cmd${i} from "./commands/${f}";`)
    .join("\n");
  const cmdMerge = cmdFiles.length
    ? `Object.assign({}, ${cmdFiles.map((_, i) => `cmd${i}`).join(", ")})`
    : "{}";

  const llmImports = llmFiles
    .map((rel) => `import "./${rel.replace(/\\/g, "/")}";`)
    .join("\n");
  const chatImports = chatFiles
    .map((rel) => `import "./${rel.replace(/\\/g, "/")}";`)
    .join("\n");

  return `// AUTO-GENERATED at build time by scripts/build.ts. Do not edit.
${cmdImports}
${llmImports}
${chatImports}

export async function loadCommandModules() {
  return ${cmdMerge};
}

export async function loadLlmAdapters() {
  // adapters self-register via the side-effect imports above
}

export async function loadChatAdapters() {
  // adapters self-register via the side-effect imports above
}
`;
}

const target =
  process.env.BUN_BUILD_TARGET ?? "bun-darwin-arm64";
const outfile = process.env.BUN_BUILD_OUTFILE ?? join(ROOT, "dist", "smartcrab-service");

console.log(`[build] target=${target} outfile=${outfile}`);
console.log(`[build] commands: ${listCommandFiles().join(", ") || "<none>"}`);
console.log(`[build] llm adapters: ${listAdapterIndexes("llm").join(", ") || "<none>"}`);
console.log(`[build] chat adapters: ${listAdapterIndexes("chat").join(", ") || "<none>"}`);

const result = await Bun.build({
  entrypoints: [join(SRC, "server.ts")],
  target: "bun",
  // @ts-expect-error compile is supported in Bun 1.1+ but may be missing from typings
  compile: { target, outfile },
  plugins: [
    {
      name: "smartcrab-static-loaders",
      setup(build) {
        build.onLoad({ filter: /\/_loaders\.ts$/ }, () => ({
          contents: buildLoadersStub(),
          loader: "ts",
          resolveDir: SRC,
        }));
      },
    },
  ],
});

if (!result.success) {
  console.error("[build] FAILED");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`[build] success → ${outfile}`);
