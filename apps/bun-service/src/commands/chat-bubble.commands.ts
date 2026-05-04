/**
 * RPC handlers for the SwiftUI Chat tab's bubble UI.
 *
 * Methods:
 *   - `chat.bubble-history` -> ChatBubble[]
 *   - `chat.bubble-send (content: string) -> ChatBubble`
 *
 * Bubbles are persisted to the `chat_bubbles` table when a database is wired
 * via `configureChatBubbleCommands({ db })`. Without a database (tests) the
 * handlers fall back to an in-memory array so the API stays usable.
 *
 * The send handler routes through `router.ts` (seher-ts SDK) and surfaces
 * any LLM error as an assistant bubble so the chat stays responsive.
 */

import type { Database } from "bun:sqlite";

import { getSharedMemoryStore } from "../memory/shared-store.ts";
import { route } from "../router.ts";

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

interface BubbleStore {
  list(): ChatBubble[];
  insert(bubble: ChatBubble): void;
}

class InMemoryBubbleStore implements BubbleStore {
  private readonly bubbles: ChatBubble[] = [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Welcome to SmartCrab. Configure an LLM provider in Settings to start chatting.",
      createdAt: new Date().toISOString(),
    },
  ];

  list(): ChatBubble[] {
    return [...this.bubbles];
  }

  insert(bubble: ChatBubble): void {
    this.bubbles.push(bubble);
  }
}

class SqliteBubbleStore implements BubbleStore {
  constructor(private readonly db: Database) {
    // Ensure a welcome bubble exists when the table is empty so the UI
    // always has something on first launch.
    const count = this.db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM chat_bubbles")
      .get();
    if (!count || count.n === 0) {
      this.insert({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Welcome to SmartCrab. Configure an LLM provider in Settings to start chatting.",
        createdAt: new Date().toISOString(),
      });
    }
  }

  list(): ChatBubble[] {
    return this.db
      .query<ChatBubble, []>(
        "SELECT id, role, content, created_at AS createdAt FROM chat_bubbles ORDER BY created_at ASC, id ASC",
      )
      .all();
  }

  insert(bubble: ChatBubble): void {
    this.db
      .query("INSERT INTO chat_bubbles (id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)")
      .run(bubble.id, bubble.role, bubble.content, bubble.createdAt);
  }
}

let store: BubbleStore = new InMemoryBubbleStore();

export function configureChatBubbleCommands(opts: { db?: Database } = {}): void {
  store = opts.db ? new SqliteBubbleStore(opts.db) : new InMemoryBubbleStore();
}

const handlers = {
  "chat.bubble-history": (): ChatBubble[] => store.list(),
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
    store.insert(userBubble);

    let assistantText: string;
    try {
      const result = await route({ prompt: content });
      assistantText = result.text;
    } catch (err) {
      assistantText = `LLM error: ${(err as Error).message}`;
    }

    const assistantBubble: ChatBubble = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
    };
    store.insert(assistantBubble);

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
