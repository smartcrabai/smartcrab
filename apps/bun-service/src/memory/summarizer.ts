import type { MemoryEntry } from "./store.ts";

export interface SummarizerLlm {
  complete(prompt: string): Promise<string>;
}

export interface SummarizeOptions {
  /** Maximum characters of source text to feed the LLM. */
  maxChars?: number;
  /** Optional system/preamble guidance prepended to the prompt. */
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a concise summarizer. Extract durable facts, decisions, and patterns from the following memory entries. Output a short paragraph.";

export async function summarize(
  entries: MemoryEntry[],
  llm: SummarizerLlm,
  options: SummarizeOptions = {},
): Promise<string> {
  if (entries.length === 0) return "";
  const maxChars = options.maxChars ?? 8000;
  const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const lines = entries.map(
    (e) => `- [${e.kind}#${e.id}] ${e.content.replace(/\s+/g, " ").trim()}`,
  );
  let body = lines.join("\n");
  if (body.length > maxChars) body = body.slice(0, maxChars);

  const prompt = `${system}\n\nEntries:\n${body}\n\nSummary:`;
  const out = await llm.complete(prompt);
  return out.trim();
}
