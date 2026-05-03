/**
 * Skills JSON-RPC command surface.
 *
 * Default export is the dispatcher map consumed by Unit 4's
 * `import.meta.glob('./commands/*.commands.ts', { eager: true })` loader.
 *
 * Methods (mirrors `crates/.../commands/skills.rs` plus auto-gen):
 *   - `skill.list`           -> SkillInfo[]
 *   - `skill.get`            -> SkillInfo
 *   - `skill.create`         -> SkillInfo
 *   - `skill.delete`         -> { ok: true }
 *   - `skill.invoke`         -> SkillInvocationResult
 *   - `skill.auto-generate`  -> SkillInfo
 *
 * The registry, loader, LLM adapter, and trace store are wired in by the
 * server (Unit 4) at boot. Tests inject fakes via `configureSkillsCommands`.
 */

import { SkillsRegistry } from "../skills/registry.ts";
import { autoGenerate } from "../skills/auto-gen.ts";
import { loadFromDisk, mergeIntoRegistry } from "../skills/loader.ts";
import type {
  ExecutionTrace,
  LlmAdapter,
  SkillCreateInput,
} from "../skills/types.ts";

interface SkillsContext {
  registry: SkillsRegistry;
  llm?: LlmAdapter;
  /** Resolves the markdown body for a skill on demand. */
  bodyResolver?: Parameters<SkillsRegistry["invoke"]>[3];
  /** Returns recent execution traces for `skill.auto-generate`. */
  traceProvider?: () => Promise<ExecutionTrace[]> | ExecutionTrace[];
  /** Override the on-disk skills directory (defaults to `~/Library/...`). */
  skillsDir?: string;
}

let ctx: SkillsContext = {
  registry: new SkillsRegistry(),
};

/** Wire up dependencies (called by the server bootstrap or tests). */
export function configureSkillsCommands(next: SkillsContext): void {
  ctx = next;
}

/** Reset to a default empty registry (test helper). */
export function resetSkillsCommands(): void {
  ctx = { registry: new SkillsRegistry() };
}

interface JsonRpcParams {
  [key: string]: unknown;
}

const commands = {
  "skill.list": async (_params?: JsonRpcParams) => {
    return ctx.registry.list();
  },

  "skill.get": async (params?: JsonRpcParams) => {
    const id = String(params?.id ?? "");
    const skill = ctx.registry.get(id);
    if (!skill) throw new Error(`skill '${id}' not found`);
    return skill;
  },

  "skill.create": async (params?: JsonRpcParams) => {
    const input = (params ?? {}) as unknown as SkillCreateInput;
    if (!input.name) throw new Error("skill.create: 'name' is required");
    return ctx.registry.save(input);
  },

  "skill.delete": async (params?: JsonRpcParams) => {
    const id = String(params?.id ?? "");
    const removed = ctx.registry.delete(id);
    if (!removed) throw new Error(`skill '${id}' not found`);
    return { ok: true };
  },

  "skill.invoke": async (params?: JsonRpcParams) => {
    const id = String(params?.id ?? "");
    const input = params?.input ?? null;
    if (!ctx.llm) throw new Error("skill.invoke: no LLM adapter configured");
    return ctx.registry.invoke(id, input, ctx.llm, ctx.bodyResolver);
  },

  "skill.auto-generate": async (params?: JsonRpcParams) => {
    if (!ctx.llm)
      throw new Error("skill.auto-generate: no LLM adapter configured");
    let traces: ExecutionTrace[];
    if (Array.isArray(params?.traces)) {
      traces = params.traces as ExecutionTrace[];
    } else if (ctx.traceProvider) {
      traces = await ctx.traceProvider();
    } else {
      traces = [];
    }
    if (traces.length === 0) {
      throw new Error(
        "skill.auto-generate: no traces provided and no traceProvider configured",
      );
    }
    const skill = await autoGenerate(traces, ctx.llm);
    return ctx.registry.save(skill);
  },

  /** Reload the registry from disk + DB (useful after manual file edits). */
  "skill.reload": async (_params?: JsonRpcParams) => {
    const fromDisk = await loadFromDisk(ctx.skillsDir);
    mergeIntoRegistry(ctx.registry, fromDisk);
    return ctx.registry.list();
  },
};

export default commands;
