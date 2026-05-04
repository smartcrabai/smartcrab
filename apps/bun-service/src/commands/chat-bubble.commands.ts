/**
 * RPC handlers for the SwiftUI Chat tab's bubble UI.
 *
 * Methods:
 *   - `chat.bubble-history` -> ChatBubble[]
 *   - `chat.bubble-send (content: string) -> ChatBubble`
 *
 * Bubbles are kept in memory for now; persistence to a SQLite table is a
 * followup PR. The send handler routes to the default LLM adapter
 * (typically Claude when ANTHROPIC_API_KEY is set) and surfaces any
 * adapter error as an assistant bubble so the chat stays responsive.
 */

import { llmRegistry } from "../adapters/llm/registry.ts";

interface ChatBubble {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

const bubbles: ChatBubble[] = [
  {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "Welcome to SmartCrab. Configure an LLM provider in Settings to start chatting.",
    createdAt: new Date().toISOString(),
  },
];

const handlers = {
  "chat.bubble-history": (): ChatBubble[] => bubbles,
  "chat.bubble-send": async (params: { content: string }): Promise<ChatBubble> => {
    const content = params?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("chat.bubble-send: 'content' is required");
    }
    const userBubble: ChatBubble = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    bubbles.push(userBubble);

    const adapter = llmRegistry.default();
    let assistantText: string;
    if (!adapter) {
      assistantText = "(no LLM adapter registered — set ANTHROPIC_API_KEY and restart)";
    } else {
      try {
        const response = await adapter.complete({
          messages: [{ role: "user", content }],
        });
        assistantText = response.content;
      } catch (err) {
        assistantText = `LLM error: ${(err as Error).message}`;
      }
    }
    const assistantBubble: ChatBubble = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
    };
    bubbles.push(assistantBubble);
    return assistantBubble;
  },
} as const;

export type ChatBubbleCommandMap = typeof handlers;
export default handlers;
