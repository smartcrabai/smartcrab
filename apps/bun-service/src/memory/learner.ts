import type { MemoryStore, MemoryEntry } from "./store.ts";
import { summarize, type SummarizerLlm } from "./summarizer.ts";

export interface LearnLoopOptions {
  store: MemoryStore;
  llm: SummarizerLlm;
  /** How many recent entries to consider per cycle. */
  windowSize?: number;
  /** Minimum entries required before a summary is produced. */
  minEntries?: number;
}

export interface LearnLoopResult {
  summarized: number;
  summaryId: number | null;
  summary: string;
}

/**
 * One iteration of the hermes-style self-learning loop:
 * fetch recent episodic entries -> summarize via LLM -> persist as a
 * `summary` kind entry that future searches can surface.
 */
export async function runLearnLoop(
  opts: LearnLoopOptions,
): Promise<LearnLoopResult> {
  const window = opts.windowSize ?? 50;
  const minEntries = opts.minEntries ?? 3;

  const recent: MemoryEntry[] = opts.store
    .getRecent(window)
    .filter((e) => e.kind !== "summary");

  if (recent.length < minEntries) {
    return { summarized: 0, summaryId: null, summary: "" };
  }

  const summary = await summarize(recent, opts.llm);
  if (!summary) {
    return { summarized: recent.length, summaryId: null, summary: "" };
  }

  const written = opts.store.add({
    kind: "summary",
    content: summary,
    metadata: {
      source_ids: recent.map((e) => e.id),
      generated_at: Math.floor(Date.now() / 1000),
    },
  });

  return {
    summarized: recent.length,
    summaryId: written.id,
    summary,
  };
}
