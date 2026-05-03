import { MemoryStore, type NewMemoryEntry } from "../memory/store.ts";
import { summarize, type SummarizerLlm } from "../memory/summarizer.ts";

// Inline CommandMap shape — kept compatible with the Unit 4 contract in
// `../types.ts` but declared locally so this file is self-contained while
// Unit 9 lands ahead of / alongside Unit 4.
type CommandHandler = (params?: unknown) => unknown | Promise<unknown>;
type CommandMap = Record<string, CommandHandler>;

interface AddParams {
  content: string;
  kind?: string;
  metadata?: Record<string, unknown> | null;
}

interface SearchParams {
  query: string;
  k?: number;
}

interface SummarizeParams {
  ids?: number[];
  windowSize?: number;
}

interface ListRecentParams {
  n?: number;
}

interface MemoryCommandDeps {
  store?: MemoryStore;
  llm?: SummarizerLlm;
}

export function createMemoryCommands(deps: MemoryCommandDeps = {}): CommandMap {
  const store = deps.store ?? new MemoryStore();

  return {
    "memory.add": (params) => {
      const p = params as AddParams | undefined;
      if (!p || typeof p.content !== "string") {
        throw new Error("memory.add requires { content: string }");
      }
      const entry: NewMemoryEntry = {
        content: p.content,
        kind: p.kind,
        metadata: p.metadata ?? null,
      };
      return store.add(entry);
    },

    "memory.search": (params) => {
      const p = params as SearchParams | undefined;
      if (!p || typeof p.query !== "string") {
        throw new Error("memory.search requires { query: string }");
      }
      return store.search(p.query, p.k ?? 10);
    },

    "memory.list-recent": (params) => {
      const p = (params ?? {}) as ListRecentParams;
      return store.getRecent(p.n ?? 20);
    },

    "memory.summarize": async (params) => {
      if (!deps.llm) {
        throw new Error("memory.summarize requires an LLM dependency");
      }
      const p = (params ?? {}) as SummarizeParams;
      const entries = p.ids
        ? store.getByIds(p.ids)
        : store.getRecent(p.windowSize ?? 50);
      return summarize(entries, deps.llm);
    },
  };
}

// Default export uses a process-singleton store for the dispatcher.
const defaultCommands = createMemoryCommands();
export default defaultCommands;
