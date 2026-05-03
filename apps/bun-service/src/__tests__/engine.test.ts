/**
 * Tests for the pipeline execution engine.
 *
 * Covers: YAML parsing + node-kind resolution, the loop guard, and end-to-end
 * pipeline execution against a mocked LLM registry. Uses `bun test`.
 */

import { describe, expect, test } from "bun:test";

import { parsePipeline } from "../engine/yaml-parser.ts";
import { LoopGuard } from "../engine/loop-guard.ts";
import { executePipeline } from "../engine/executor.ts";
import type {
  ExecutorDeps,
  LlmAdapter,
} from "../engine/dynamic-node.ts";
import type { NodeExecutionEvent } from "../engine/executor.ts";

const DISCORD_PIPELINE = `
name: discord-claude-bot
version: "1.0"
trigger:
  type: discord
  triggers: [mention, dm]
nodes:
  - id: receive_message
    name: Discord Receive
    next: process_with_claude
  - id: process_with_claude
    name: Claude Processing
    action:
      type: llm_call
      provider: claude
      prompt: "test"
      timeout_secs: 60
    next: send_reply
  - id: send_reply
    name: Discord Reply
`;

const HEALTH_CHECK_PIPELINE = `
name: health-check
version: "1.0"
trigger:
  type: cron
  schedule: "*/5 * * * *"
nodes:
  - id: health_check
    name: Health Check Start
    next: check_api
  - id: check_api
    name: API Check
  - id: notify
    name: Send Notification
`;

describe("parsePipeline", () => {
  test("resolves node kinds for a simple chain", () => {
    const resolved = parsePipeline(DISCORD_PIPELINE);
    expect(resolved.definition.name).toBe("discord-claude-bot");
    expect(resolved.nodeTypes.get("receive_message")).toBe("Input");
    expect(resolved.nodeTypes.get("process_with_claude")).toBe("Hidden");
    expect(resolved.nodeTypes.get("send_reply")).toBe("Output");
  });

  test("supports both single and array next targets", () => {
    const yaml = `
name: fanout
version: "1.0"
trigger:
  type: discord
nodes:
  - id: a
    name: A
    next:
      - b
      - c
  - id: b
    name: B
  - id: c
    name: C
`;
    const resolved = parsePipeline(yaml);
    const a = resolved.definition.nodes.find((n) => n.id === "a")!;
    expect(Array.isArray(a.next)).toBe(true);
    expect((a.next as string[]).sort()).toEqual(["b", "c"]);
  });

  test("throws on malformed YAML", () => {
    expect(() => parsePipeline("not: [valid: yaml:")).toThrow();
  });

  test("max_loop_count round-trips", () => {
    const yaml = `
name: loop
version: "1.0"
trigger:
  type: discord
max_loop_count: 5
nodes:
  - id: start
    name: Start
`;
    expect(parsePipeline(yaml).definition.max_loop_count).toBe(5);
  });
});

describe("LoopGuard", () => {
  test("enforces per-node iteration limit", () => {
    const guard = new LoopGuard(3);
    expect(guard.checkAndIncrement("a")).toBe(1);
    expect(guard.checkAndIncrement("a")).toBe(2);
    expect(guard.checkAndIncrement("a")).toBe(3);
    expect(() => guard.checkAndIncrement("a")).toThrow(/Loop limit/);
  });

  test("tracks nodes independently", () => {
    const guard = new LoopGuard(1);
    expect(guard.tick("x")).toBe(true);
    expect(guard.tick("y")).toBe(true);
    expect(guard.tick("x")).toBe(false);
  });

  test("reset clears counts", () => {
    const guard = new LoopGuard(1);
    guard.checkAndIncrement("a");
    guard.reset();
    expect(guard.checkAndIncrement("a")).toBe(1);
  });
});

describe("executePipeline", () => {
  test("runs nodes in topological order with mocked LLM", async () => {
    const llm: LlmAdapter = {
      executePrompt: async (req) => ({
        content: `LLM(${req.prompt})`,
      }),
    };
    const deps: ExecutorDeps = {
      llmRegistry: new Map([["claude", llm]]),
    };

    const resolved = parsePipeline(DISCORD_PIPELINE);
    const events: NodeExecutionEvent[] = [];
    for await (const ev of executePipeline(resolved, { msg: "hi" }, deps)) {
      events.push(ev);
    }

    const startedNodes = events
      .filter((e) => e.type === "node_started")
      .map((e) => (e as { nodeId: string }).nodeId);
    expect(startedNodes).toEqual([
      "receive_message",
      "process_with_claude",
      "send_reply",
    ]);

    const final = events.at(-1)!;
    expect(final.type).toBe("execution_completed");
    expect((final as { status: string }).status).toBe("completed");

    // The LLM node's output should propagate downstream.
    const llmCompleted = events.find(
      (e) => e.type === "node_completed" && e.nodeId === "process_with_claude",
    );
    expect((llmCompleted as { data: string }).data).toBe("LLM(test)");
  });

  test("emits node_failed when an LLM provider is missing", async () => {
    const deps: ExecutorDeps = { llmRegistry: new Map() };
    const resolved = parsePipeline(DISCORD_PIPELINE);
    const events: NodeExecutionEvent[] = [];
    for await (const ev of executePipeline(resolved, null, deps)) {
      events.push(ev);
    }
    const failed = events.find((e) => e.type === "node_failed");
    expect(failed).toBeDefined();
    const completed = events.at(-1)!;
    expect((completed as { status: string }).status).toBe("failed");
  });

  test("passes through nodes without an action", async () => {
    const resolved = parsePipeline(HEALTH_CHECK_PIPELINE);
    const events: NodeExecutionEvent[] = [];
    for await (const ev of executePipeline(resolved, { ping: true }, {})) {
      events.push(ev);
    }
    // All three nodes complete: health_check + check_api are linked, and
    // notify has no incoming edges, so it starts in parallel as a separate
    // root (matches the original Rust scheduler's "predecessor_count == 0
    // means ready" rule).
    const completed = events.filter((e) => e.type === "node_completed");
    expect(completed.length).toBe(3);
    expect((events.at(-1) as { status: string }).status).toBe("completed");
  });
});
