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
 * The send handler routes through `router.ts` (which spawns the seher-bridge
 * Rust binary) and surfaces any LLM error as an assistant bubble so the chat
 * stays responsive.
 */

import type { Database } from "bun:sqlite";
import YAML from "yaml";

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

/**
 * Tool wiring so the LLM can author a pipeline mid-conversation. Reuses the
 * shared `submit_pipeline` factory but persists via `pipeline.save` (which
 * itself validates YAML) so the new pipeline shows up in the Pipelines tab
 * after the user refreshes. A fresh tool per turn avoids stale closures.
 *
 * The pipeline modules are dynamically imported: a static `import` from this
 * command module into `pipeline-author`/`pipeline.commands` (which reach
 * `router` → `llmRegistry`) deepens the bundle's init-order cycle and leaves
 * `llmRegistry` undefined when adapters self-register. Lazy import keeps those
 * edges off the module-load graph (same pattern server.ts uses).
 */
async function submitPipelineTool() {
  const { makePipelineSubmitTool } = await import("./pipeline-author.commands.ts");
  return makePipelineSubmitTool({
    description:
      "Create a new SmartCrab pipeline. Call this when the user asks you to make a pipeline. Provide the complete pipeline definition; do not output YAML inline. Note: this always creates a new pipeline (it cannot edit an existing one).",
    onSubmit: async (pipeline): Promise<string> => {
      try {
        const { default: pipelineHandlers } = await import("./pipeline.commands.ts");
        const saved = await pipelineHandlers["pipeline.save"]({
          name: pipeline.name,
          description: pipeline.description,
          yaml_content: YAML.stringify(pipeline),
        });
        return `Saved pipeline "${saved.name}" (id=${saved.id}).`;
      } catch (err) {
        return `submit_pipeline failed: ${(err as Error).message}`;
      }
    },
  });
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
      const result = await route({
        prompt: content,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [(await submitPipelineTool()) as any],
      });
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
