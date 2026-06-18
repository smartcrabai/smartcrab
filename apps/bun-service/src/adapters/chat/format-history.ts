export interface HistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Build a seher-bridge prompt by prepending history messages before the current
 * user message. When history is empty, returns current as-is (single-turn).
 * Callers are responsible for pre-filtering history to the desired limit before
 * calling this function.
 *
 * NOTE: Temporary — replace when seher-bridge RunRequest gains a native
 * `messages` array field for structured multi-turn input.
 */
export function buildPromptWithHistory(
  history: HistoryMessage[],
  current: string,
): string {
  if (history.length === 0) return current;
  const lines = history.map((m) => {
    const label =
      m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
    return `${label}: ${m.content}`;
  });
  lines.push(`User: ${current}`);
  return lines.join("\n\n");
}
