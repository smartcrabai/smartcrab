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
import { buildPromptWithHistory, type HistoryMessage } from "../adapters/chat/format-history.ts";
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
  /** Return the N most recent bubbles in ascending chronological order. */
  listRecent(n: number): ChatBubble[];
}

class InMemoryBubbleStore implements BubbleStore {
  private readonly bubbles: ChatBubble[] = [
    {
      id: crypto.randomUUID(),
      // "system" role so this UI-only message is excluded from LLM history.
      role: "system",
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

  listRecent(n: number): ChatBubble[] {
    if (n <= 0) return [];
    // Exclude system messages (e.g. UI-only welcome bubble) from LLM context.
    // Each "turn" is a user + assistant pair; fetch 2n messages to cover n turns.
    const conversational = this.bubbles.filter((b) => b.role !== "system");
    return conversational.slice(-(n * 2));
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
        // "system" role so this UI-only message is excluded from LLM history.
        role: "system",
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

  listRecent(n: number): ChatBubble[] {
    if (n <= 0) return [];
    // Exclude system messages (e.g. UI-only welcome bubble) from LLM context.
    // Fetch 2n messages (n turns) newest-first, then reverse to chronological order.
    const rows = this.db
      .query<ChatBubble, [number]>(
        "SELECT id, role, content, created_at AS createdAt FROM chat_bubbles WHERE role != 'system' ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(n * 2);
    return rows.reverse();
  }
}

export const DEFAULT_CHAT_CONTEXT_LIMIT = 10;

let store: BubbleStore = new InMemoryBubbleStore();
let getContextLimit: () => number = () => DEFAULT_CHAT_CONTEXT_LIMIT;

export function configureChatBubbleCommands(opts: {
  db?: Database;
  /** Returns the number of previous messages to include in the LLM prompt. Queried per-request. */
  getContextLimit?: () => number;
} = {}): void {
  store = opts.db ? new SqliteBubbleStore(opts.db) : new InMemoryBubbleStore();
  getContextLimit = opts.getContextLimit ?? (() => DEFAULT_CHAT_CONTEXT_LIMIT);
}

/**
 * Tool wiring so the LLM can manage pipelines mid-conversation: create
 * (`submit_pipeline`), enumerate (`list_pipelines`), overwrite
 * (`edit_pipeline`), and remove (`delete_pipeline`). All persist via the
 * `pipeline.*` handlers (`pipeline.save` validates YAML) so changes show up in
 * the Pipelines tab after the user refreshes. Fresh tools per turn avoid stale
 * closures, and the router supports multiple tool rounds so the LLM can chain
 * `list_pipelines` → `edit_pipeline`/`delete_pipeline` in a single turn.
 *
 * The pipeline modules are dynamically imported: a static `import` from this
 * command module into `pipeline-author`/`pipeline.commands` (which reach
 * `router` → `llmRegistry`) deepens the bundle's init-order cycle and leaves
 * `llmRegistry` undefined when adapters self-register. Lazy import keeps those
 * edges off the module-load graph (same pattern server.ts uses).
 */
async function pipelineTools() {
  const {
    makePipelineSubmitTool,
    makePipelineListTool,
    makePipelineGetTool,
    makePipelineEditTool,
    makePipelineDeleteTool,
  } = await import("./pipeline-author.commands.ts");
  const { default: pipelineHandlers } = await import("./pipeline.commands.ts");

  const submit = makePipelineSubmitTool({
    description:
      "Create a NEW SmartCrab pipeline. Call this when the user asks you to make a pipeline. Provide the complete pipeline definition; do not output YAML inline. This always creates a new pipeline — to change an existing one, use edit_pipeline.",
    onSubmit: async (pipeline): Promise<string> => {
      try {
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

  const list = makePipelineListTool({
    description:
      "List existing SmartCrab pipelines (id, name, description). Call this first to find the id of the pipeline you want to read, edit, or delete. Use get_pipeline to see a pipeline's full YAML.",
    onList: async (): Promise<string> => {
      try {
        const rows = await pipelineHandlers["pipeline.list"]();
        if (rows.length === 0) return "No pipelines exist yet.";
        const summary = rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
        }));
        return JSON.stringify(summary);
      } catch (err) {
        return `list_pipelines failed: ${(err as Error).message}`;
      }
    },
  });

  const get = makePipelineGetTool({
    description:
      "Read one existing pipeline's full definition (including its current YAML) by id. Call this before edit_pipeline so you can base the updated definition on the current state.",
    onGet: async (id): Promise<string> => {
      try {
        const row = await pipelineHandlers["pipeline.get"]({ id });
        return JSON.stringify({
          id: row.id,
          name: row.name,
          description: row.description,
          yaml_content: row.yaml_content,
        });
      } catch (err) {
        return `get_pipeline failed: ${(err as Error).message}`;
      }
    },
  });

  const edit = makePipelineEditTool({
    description:
      "Overwrite an EXISTING pipeline. Call list_pipelines (and usually get_pipeline) first to get the id and current state, then provide that id plus the COMPLETE updated pipeline definition (the full new state, not a diff). Do not output YAML inline.",
    onEdit: async (id, pipeline): Promise<string> => {
      try {
        // Confirm the pipeline exists before saving: pipeline.save upserts by
        // id, so without this guard a hallucinated id would silently create a
        // NEW pipeline instead of editing. pipeline.get throws when unknown.
        await pipelineHandlers["pipeline.get"]({ id });
        const saved = await pipelineHandlers["pipeline.save"]({
          id,
          name: pipeline.name,
          description: pipeline.description,
          yaml_content: YAML.stringify(pipeline),
        });
        return `Updated pipeline "${saved.name}" (id=${saved.id}).`;
      } catch (err) {
        return `edit_pipeline failed: ${(err as Error).message}`;
      }
    },
  });

  const remove = makePipelineDeleteTool({
    description:
      "Delete an existing pipeline by id. Call list_pipelines first to confirm the correct id. This is irreversible.",
    onDelete: async (id): Promise<string> => {
      try {
        await pipelineHandlers["pipeline.delete"]({ id });
        return `Deleted pipeline (id=${id}).`;
      } catch (err) {
        return `delete_pipeline failed: ${(err as Error).message}`;
      }
    },
  });

  return [submit, list, get, edit, remove];
}

const handlers = {
  "chat.bubble-history": (): ChatBubble[] => store.list(),
  "chat.bubble-send": async (params: { content: string }): Promise<ChatBubble> => {
    const content = params?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("chat.bubble-send: 'content' is required");
    }
    const limit = getContextLimit();
    const recentHistory: HistoryMessage[] = store.listRecent(limit).map((b) => ({
      role: b.role,
      content: b.content,
    }));
    const prompt = buildPromptWithHistory(recentHistory, content);

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
        prompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: (await pipelineTools()) as any,
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
