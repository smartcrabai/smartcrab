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
import { getSharedMemoryStore } from "../memory/shared-store.ts";

interface ChatBubble {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

/// Self-learning hook is opt-out. Tests can flip this off via setMemoryHookEnabled(false).
let memoryHookEnabled = true;

export function setMemoryHookEnabled(enabled: boolean): void {
  memoryHookEnabled = enabled;
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

    // hermes-style self-learning hook: record the turn into the shared memory
    // store so a later memory.summarize call can distil reusable knowledge.
    if (memoryHookEnabled) {
      try {
        getSharedMemoryStore().add({
          kind: "chat",
          content: `user: ${content}\nassistant: ${assistantText}`,
          metadata: { userBubbleId: userBubble.id, assistantBubbleId: assistantBubble.id },
        });
      } catch (err) {
        console.error("[chat-bubble] memory.add failed:", err);
      }
    }

    return assistantBubble;
  },
} as const;

export type ChatBubbleCommandMap = typeof handlers;
export default handlers;
