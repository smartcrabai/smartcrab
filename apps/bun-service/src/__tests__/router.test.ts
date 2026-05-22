import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { silenceConsoleError } from "./test-helpers.ts";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Bun hoists mock.module() above static imports, so these always run first.

let seherConstructorLastOpts: Record<string, unknown> | undefined;
let seherRunBehavior: "succeed" | "throw" = "throw";

mock.module("@seher-ts/sdk", () => ({
  SeherSDK: class MockSeherSDK {
    constructor(opts: Record<string, unknown>) {
      seherConstructorLastOpts = opts;
    }
    async run(_opts: unknown): Promise<{ text: string; kind: string }> {
      if (seherRunBehavior === "throw") throw new Error("seher: rate limited");
      return { text: "seher-response", kind: "claude" };
    }
  },
}));

mock.module("zod-to-json-schema", () => ({
  zodToJsonSchema: (_schema: unknown) => ({ type: "object", properties: {} }),
}));

// Bun hoists mock.module() before const declarations, so MOCK_SEHER_CONFIG_PATH can't be referenced here.
mock.module("../seher/write-settings", () => ({
  defaultSeherConfigPath: () => "/mock/seher/config.jsonc",
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { route } from "../router.ts";
import { clearLlmAdapters, llmRegistry } from "../adapters/llm/registry.ts";
import type { LlmAdapter, LlmRequest, LlmResponse } from "../adapters/llm/types.ts";
import type { SeherTool } from "@seher-ts/sdk";

// ── Helpers ───────────────────────────────────────────────────────────────────

class MockAdapter implements LlmAdapter {
  readonly id = "mock";
  readonly capabilities = { streaming: false, tools: true, maxContextTokens: 200_000 };
  readonly requests: LlmRequest[] = [];
  private readonly responses: LlmResponse[];
  private callCount = 0;

  constructor(responses: LlmResponse[]) {
    this.responses = responses;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    return this.responses[this.callCount++] ?? { content: "done" };
  }
}

/**
 * Build a minimal SeherTool-compatible object without a real ZodObject
 * dependency. `parameters.parse` forwards input as-is; `zod-to-json-schema`
 * is mocked to return a fixed schema, so no real ZodObject is needed.
 */
function mockTool(
  name: string,
  handler: (args: Record<string, unknown>) => string | Promise<string>,
): SeherTool {
  return {
    name,
    description: `${name} tool`,
    // Minimal ZodObject-like: parse returns input unchanged.
    parameters: { parse: (input: unknown) => input as Record<string, unknown> },
    handler,
  } as unknown as SeherTool;
}

// ── Test setup ────────────────────────────────────────────────────────────────

const consoleSpy = silenceConsoleError();

const MOCK_SEHER_CONFIG_PATH = "/mock/seher/config.jsonc";

beforeEach(() => {
  seherRunBehavior = "throw"; // default: force fallback path so most tests stay isolated
  seherConstructorLastOpts = undefined;
  clearLlmAdapters();
  consoleSpy.setup();
});

afterEach(() => {
  consoleSpy.restore();
});

// ── RouteRequest interface ────────────────────────────────────────────────────

describe("RouteRequest — tools field", () => {
  it("is optional: a request without tools succeeds", async () => {
    const adapter = new MockAdapter([{ content: "hi" }]);
    llmRegistry.register(adapter);

    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("hi");
  });

  it("accepts a request with a tools array", async () => {
    const adapter = new MockAdapter([{ content: "ok" }]);
    llmRegistry.register(adapter);

    const result = await route({
      prompt: "hello",
      tools: [mockTool("echo", () => "echoed")],
    });

    expect(result.text).toBe("ok");
  });
});

// ── SeherSDK path ─────────────────────────────────────────────────────────────

describe("route() — SeherSDK path", () => {
  beforeEach(() => {
    seherRunBehavior = "succeed";
  });

  it("returns text and kind from SeherSDK when it succeeds", async () => {
    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("seher-response");
    expect(result.kind).toBe("claude");
  });

  it("passes tools to the SeherSDK constructor", async () => {
    const tools = [mockTool("search", () => "results")];

    await route({ prompt: "hello", tools });

    expect(seherConstructorLastOpts?.tools).toBe(tools);
  });

  it("passes configPath to the SeherSDK constructor", async () => {
    await route({ prompt: "hello" });

    expect(seherConstructorLastOpts?.configPath).toBe(MOCK_SEHER_CONFIG_PATH);
  });

  it("sets noWait: true on the SeherSDK constructor", async () => {
    await route({ prompt: "hello" });

    expect(seherConstructorLastOpts?.noWait).toBe(true);
  });

  it("falls through to fallback when SeherSDK.run() throws", async () => {
    seherRunBehavior = "throw";
    const adapter = new MockAdapter([{ content: "fallback-response" }]);
    llmRegistry.register(adapter);

    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("fallback-response");
    expect(result.kind).toBe("registry-fallback");
  });
});

// ── Fallback path — no tools ──────────────────────────────────────────────────

describe("route() — fallback path (no tools)", () => {
  it("throws when no adapter is registered", async () => {
    await expect(route({ prompt: "hello" })).rejects.toThrow(
      /seher-ts unavailable and no LLM adapter registered/,
    );
  });

  it("returns adapter text with kind 'registry-fallback'", async () => {
    const adapter = new MockAdapter([{ content: "fallback result" }]);
    llmRegistry.register(adapter);

    const result = await route({ prompt: "hello world" });

    expect(result.text).toBe("fallback result");
    expect(result.kind).toBe("registry-fallback");
  });

  it("sends the prompt as a single user message to the adapter", async () => {
    const adapter = new MockAdapter([{ content: "ok" }]);
    llmRegistry.register(adapter);

    await route({ prompt: "test prompt" });

    expect(adapter.requests[0]?.messages).toEqual([
      { role: "user", content: "test prompt" },
    ]);
  });
});

// ── Fallback path — handler loop ──────────────────────────────────────────────

describe("route() — fallback path handler loop", () => {
  it("returns immediately when adapter returns no tool calls", async () => {
    const adapter = new MockAdapter([{ content: "direct answer" }]);
    llmRegistry.register(adapter);
    const tool = mockTool("echo", () => "echoed");

    const result = await route({ prompt: "hello", tools: [tool] });

    expect(result.text).toBe("direct answer");
    expect(adapter.requests.length).toBe(1);
  });

  it("includes tool definitions in the initial complete() call", async () => {
    const adapter = new MockAdapter([{ content: "answer" }]);
    llmRegistry.register(adapter);
    const tool = mockTool("search", () => "results");

    await route({ prompt: "hello", tools: [tool] });

    expect(adapter.requests[0]?.tools?.length).toBe(1);
    expect(adapter.requests[0]?.tools?.[0]?.name).toBe("search");
    expect(adapter.requests[0]?.tools?.[0]?.description).toBe("search tool");
    // input_schema comes from the mocked zodToJsonSchema
    expect(adapter.requests[0]?.tools?.[0]?.input_schema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("dispatches tool handler and sends result back as a tool message", async () => {
    const adapter = new MockAdapter([
      {
        content: "calling echo",
        toolCalls: [{ id: "tc_1", name: "echo", input: { message: "hello" } }],
      },
      { content: "final answer" },
    ]);
    llmRegistry.register(adapter);

    let handlerCalledWith: unknown;
    const tool = mockTool("echo", (args) => {
      handlerCalledWith = args;
      return "echoed: hello";
    });

    const result = await route({ prompt: "test", tools: [tool] });

    expect(handlerCalledWith).toEqual({ message: "hello" });
    expect(result.text).toBe("final answer");
    const secondReq = adapter.requests[1]!;
    const toolMsg = secondReq.messages?.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("echoed: hello");
  });

  it("appends assistant message before tool result when content is present", async () => {
    const adapter = new MockAdapter([
      {
        content: "let me check",
        toolCalls: [{ id: "tc_1", name: "echo", input: {} }],
      },
      { content: "done" },
    ]);
    llmRegistry.register(adapter);

    await route({
      prompt: "test",
      tools: [mockTool("echo", () => "ok")],
    });

    const secondReq = adapter.requests[1]!;
    const assistantMsg = secondReq.messages?.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toBe("let me check");
  });

  it("returns '[unknown tool: name]' when tool is not in the request", async () => {
    const adapter = new MockAdapter([
      {
        content: "",
        toolCalls: [{ id: "tc_1", name: "nonexistent", input: {} }],
      },
      { content: "done" },
    ]);
    llmRegistry.register(adapter);

    await route({
      prompt: "test",
      tools: [mockTool("echo", () => "ok")],
    });

    const secondReq = adapter.requests[1]!;
    const toolMsg = secondReq.messages?.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("[unknown tool: nonexistent]");
  });

  it("stops after MAX_TOOL_ROUNDS (10) and returns last response content", async () => {
    const alwaysToolCall: LlmResponse = {
      content: "still thinking",
      toolCalls: [{ id: "tc_1", name: "echo", input: {} }],
    };
    const adapter = new MockAdapter(Array(11).fill(alwaysToolCall));
    llmRegistry.register(adapter);

    const result = await route({
      prompt: "test",
      tools: [mockTool("echo", () => "ok")],
    });

    expect(adapter.requests.length).toBe(10);
    expect(result.text).toBe("still thinking");
    expect(result.kind).toBe("registry-fallback");
  });

  it("handles async tool handlers", async () => {
    const adapter = new MockAdapter([
      {
        content: "",
        toolCalls: [{ id: "tc_1", name: "fetch", input: { url: "https://example.com" } }],
      },
      { content: "fetched" },
    ]);
    llmRegistry.register(adapter);

    const tool = mockTool("fetch", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return "async-result";
    });

    await route({ prompt: "test", tools: [tool] });

    const secondReq = adapter.requests[1]!;
    const toolMsg = secondReq.messages?.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("async-result");
  });

  it("handles multiple concurrent tool calls in a single round", async () => {
    const adapter = new MockAdapter([
      {
        content: "",
        toolCalls: [
          { id: "tc_1", name: "echo", input: { message: "first" } },
          { id: "tc_2", name: "echo", input: { message: "second" } },
        ],
      },
      { content: "both done" },
    ]);
    llmRegistry.register(adapter);

    const handlerResults: string[] = [];
    const tool = mockTool("echo", ({ message }) => {
      handlerResults.push(message as string);
      return `echoed: ${message}`;
    });

    await route({ prompt: "test", tools: [tool] });

    expect(handlerResults).toEqual(["first", "second"]);
    const secondReq = adapter.requests[1]!;
    const toolMsgs = secondReq.messages?.filter((m) => m.role === "tool");
    expect(toolMsgs?.length).toBe(2);
  });
});
