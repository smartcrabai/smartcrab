import { describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { MemoryStore } from "../memory/store.ts";
import { summarize, type SummarizerLlm } from "../memory/summarizer.ts";
import { runLearnLoop } from "../memory/learner.ts";
import { createMemoryCommands } from "../commands/memory.commands.ts";

function seed(store: MemoryStore): void {
  store.add({ content: "Discord adapter requires gateway intents flag" });
  store.add({ content: "Pipeline executor uses topological sort for nodes" });
  store.add({ content: "Cron scheduler should respect timezone offsets" });
  store.add({
    content: "Skill auto-generation calls the LLM registry to compile prompts",
  });
  store.add({
    content: "Memory FTS5 unicode61 tokenizer handles CJK reasonably",
  });
}

describe("MemoryStore", () => {
  it("creates schema and inserts entries", () => {
    const store = new MemoryStore();
    seed(store);
    expect(store.count()).toBe(5);
    store.close();
  });

  it("FTS triggers fire so search returns relevant rows", () => {
    const store = new MemoryStore();
    seed(store);
    const hits = store.search("pipeline");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content).toContain("Pipeline");
    store.close();
  });

  it("getRecent returns newest first", () => {
    const store = new MemoryStore();
    seed(store);
    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.id).toBeGreaterThan(recent[1]!.id);
    store.close();
  });

  it("delete removes entries and FTS row", () => {
    const store = new MemoryStore();
    const e = store.add({ content: "ephemeral fact about webhooks" });
    expect(store.search("webhooks").length).toBe(1);
    expect(store.delete(e.id)).toBe(true);
    expect(store.search("webhooks").length).toBe(0);
    store.close();
  });

  it("accepts an injected Database", () => {
    const db = new Database(":memory:");
    const store = new MemoryStore(db);
    store.add({ content: "injected db works" });
    expect(store.count()).toBe(1);
    db.close();
  });

  it("escapes FTS operator characters in queries", () => {
    const store = new MemoryStore();
    store.add({ content: "note about the (parenthetical) discussion" });
    // Bare punctuation would otherwise raise an FTS5 syntax error.
    expect(() => store.search("(parenthetical)")).not.toThrow();
    expect(store.search("parenthetical").length).toBe(1);
    store.close();
  });

  it("returns empty array for whitespace-only queries", () => {
    const store = new MemoryStore();
    store.add({ content: "anything" });
    expect(store.search("   ")).toEqual([]);
    store.close();
  });
});

describe("summarize", () => {
  it("invokes the LLM with built prompt and returns trimmed output", async () => {
    const store = new MemoryStore();
    seed(store);
    const llm: SummarizerLlm = {
      complete: mock(async () => "  combined summary text  "),
    };
    const out = await summarize(store.getRecent(5), llm);
    expect(out).toBe("combined summary text");
    expect(llm.complete).toHaveBeenCalledTimes(1);
    const arg = (llm.complete as ReturnType<typeof mock>).mock.calls[0]![0];
    expect(arg).toContain("Pipeline executor");
    store.close();
  });

  it("returns empty string when no entries", async () => {
    const llm: SummarizerLlm = { complete: mock(async () => "x") };
    const out = await summarize([], llm);
    expect(out).toBe("");
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe("runLearnLoop", () => {
  it("summarizes recent entries and persists a summary row", async () => {
    const store = new MemoryStore();
    seed(store);
    const llm: SummarizerLlm = {
      complete: mock(async () => "the pipelines and cron need timezone care"),
    };
    const result = await runLearnLoop({ store, llm });
    expect(result.summarized).toBe(5);
    expect(result.summaryId).not.toBeNull();
    const summaries = store
      .getRecent(20)
      .filter((e) => e.kind === "summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.content).toContain("timezone");
    store.close();
  });

  it("skips when below minEntries threshold", async () => {
    const store = new MemoryStore();
    store.add({ content: "lonely note" });
    const llm: SummarizerLlm = { complete: mock(async () => "x") };
    const result = await runLearnLoop({ store, llm, minEntries: 3 });
    expect(result.summarized).toBe(0);
    expect(result.summaryId).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
    store.close();
  });
});

describe("memory.commands", () => {
  it("exposes search/add/list-recent/summarize", async () => {
    const store = new MemoryStore();
    const llm: SummarizerLlm = { complete: mock(async () => "ok summary") };
    const cmds = createMemoryCommands({ store, llm });

    await cmds["memory.add"]!({ content: "first note" });
    await cmds["memory.add"]!({ content: "second note about pipelines" });

    const list = (await cmds["memory.list-recent"]!({ n: 5 })) as Array<{
      content: string;
    }>;
    expect(list).toHaveLength(2);

    const hits = (await cmds["memory.search"]!({
      query: "pipelines",
    })) as Array<{ content: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toContain("pipelines");

    const summary = await cmds["memory.summarize"]!({});
    expect(summary).toBe("ok summary");

    store.close();
  });

  it("memory.add validates input", () => {
    const store = new MemoryStore();
    const cmds = createMemoryCommands({ store });
    expect(() => cmds["memory.add"]!({})).toThrow();
    store.close();
  });

  it("memory.summarize errors without an LLM", async () => {
    const store = new MemoryStore();
    const cmds = createMemoryCommands({ store });
    await expect(cmds["memory.summarize"]!({})).rejects.toThrow(/LLM/);
    store.close();
  });

  it("memory.summarize accepts an explicit ids list", async () => {
    const store = new MemoryStore();
    const a = store.add({ content: "alpha" });
    const b = store.add({ content: "beta" });
    store.add({ content: "ignored" });
    const llm: SummarizerLlm = {
      complete: mock(async (prompt: string) => {
        // The prompt should reference exactly the requested entries.
        expect(prompt).toContain("alpha");
        expect(prompt).toContain("beta");
        expect(prompt).not.toContain("ignored");
        return "scoped summary";
      }),
    };
    const cmds = createMemoryCommands({ store, llm });
    const out = await cmds["memory.summarize"]!({ ids: [a.id, b.id] });
    expect(out).toBe("scoped summary");
    store.close();
  });
});
