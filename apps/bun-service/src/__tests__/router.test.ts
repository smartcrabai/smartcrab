import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { silenceConsoleError } from "./test-helpers.ts";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Bun hoists mock.module() above static imports, so these always run first.

mock.module("../seher/write-settings", () => ({
  defaultSeherConfigPath: () => "/mock/seher/config.jsonc",
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { __setBridgeSpawn, route, type SeherTool } from "../router.ts";
import { clearLlmAdapters, llmRegistry } from "../adapters/llm/registry.ts";
import type { LlmAdapter, LlmRequest, LlmResponse } from "../adapters/llm/types.ts";

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
 * dependency. `parameters.parse` forwards input as-is; router's
 * `toInputSchema` falls back to a permissive `{ type: "object" }` when the
 * parameters aren't a real zod schema, so no real ZodObject is needed.
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
  };
}

interface ParsedFrame {
  type?: string;
  [k: string]: unknown;
}

/**
 * In-process fake of the seher-bridge sidecar. `script` receives each frame the
 * router writes to stdin and may push stdout/stderr frames in response. This
 * lets us drive the NDJSON protocol without spawning a real binary.
 */
function fakeBridge(
  script: (
    frame: ParsedFrame,
    emit: { stdout: (obj: unknown) => void; stderr: (line: string) => void; close: () => void },
  ) => void,
) {
  const stdinFrames: ParsedFrame[] = [];

  let pushStdout!: (obj: unknown) => void;
  let pushStderr!: (line: string) => void;
  let closeStdout!: () => void;
  let closeStderr!: () => void;

  const encoder = new TextEncoder();

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      pushStdout = (obj) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      closeStdout = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
    },
  });

  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      pushStderr = (line) => controller.enqueue(encoder.encode(`${line}\n`));
      closeStderr = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
    },
  });

  const emit = {
    stdout: (obj: unknown) => pushStdout(obj),
    stderr: (line: string) => pushStderr(line),
    close: () => {
      closeStdout();
      closeStderr();
    },
  };

  const stdin = {
    write(data: string) {
      for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const frame = JSON.parse(trimmed) as ParsedFrame;
        stdinFrames.push(frame);
        script(frame, emit);
      }
      return data.length;
    },
    flush() {},
    end() {
      closeStderr();
    },
  };

  let killed = false;
  const kill = () => {
    killed = true;
    emit.close();
  };

  return {
    stdinFrames,
    stdout,
    stderr,
    stdin,
    kill,
    get killed() {
      return killed;
    },
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

const consoleSpy = silenceConsoleError();

const MOCK_SEHER_CONFIG_PATH = "/mock/seher/config.jsonc";

beforeEach(() => {
  clearLlmAdapters();
  consoleSpy.setup();
  // Default: no bridge resolved → exercise the registry fallback. Individual
  // bridge tests install a fake via setBridge().
  process.env.SMARTCRAB_SEHER_BRIDGE = "/nonexistent/seher-bridge";
});

afterEach(() => {
  consoleSpy.restore();
  __setBridgeSpawn(null);
  delete process.env.SMARTCRAB_SEHER_BRIDGE;
});

/**
 * Point resolveBridgePath() at an existing file (this test file) and install
 * `fake` as the spawn so runViaBridge() takes the bridge path.
 */
function setBridge(fake: ReturnType<typeof fakeBridge>) {
  process.env.SMARTCRAB_SEHER_BRIDGE = import.meta.path;
  __setBridgeSpawn(() => fake as never);
}

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

// ── seher-bridge path ─────────────────────────────────────────────────────────

describe("route() — seher-bridge path", () => {
  it("returns text with kind 'pi' on a done frame", async () => {
    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "done", text: "bridge-response", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("bridge-response");
    expect(result.kind).toBe("pi");
    // A clean `done` must not kill the child.
    expect(fake.killed).toBe(false);
  });

  it("sends a run frame with prompt, systemPrompt and configPath", async () => {
    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "done", text: "ok", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    await route({ prompt: "hello", systemPrompt: "be brief" });

    const runFrame = fake.stdinFrames.find((f) => f.type === "run")!;
    expect(runFrame.prompt).toBe("hello");
    expect(runFrame.systemPrompt).toBe("be brief");
    expect(runFrame.configPath).toBe(MOCK_SEHER_CONFIG_PATH);
    expect(runFrame.model).toBeNull();
  });

  it("converts tool parameters to JSON Schema in the run frame", async () => {
    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "done", text: "ok", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    await route({ prompt: "hello", tools: [mockTool("search", () => "results")] });

    const runFrame = fake.stdinFrames.find((f) => f.type === "run")!;
    const tools = runFrame.tools as { name: string; description: string; parameters: unknown }[];
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("search");
    expect(tools[0]?.description).toBe("search tool");
    // mock parameters aren't a real zod schema → permissive fallback schema.
    expect(tools[0]?.parameters).toEqual({ type: "object", properties: {} });
  });

  it("dispatches a tool_call to the handler and replies with tool_result output", async () => {
    let handlerCalledWith: unknown;
    const tool = mockTool("echo", (args) => {
      handlerCalledWith = args;
      return "echoed: hello";
    });

    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "tool_call", id: "tc_1", name: "echo", input: { message: "hello" } });
      } else if (frame.type === "tool_result") {
        emit.stdout({ type: "done", text: "final answer", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    const result = await route({ prompt: "test", tools: [tool] });

    expect(handlerCalledWith).toEqual({ message: "hello" });
    expect(result.text).toBe("final answer");

    const toolResult = fake.stdinFrames.find((f) => f.type === "tool_result")!;
    expect(toolResult.id).toBe("tc_1");
    expect(toolResult.output).toBe("echoed: hello");
    expect(toolResult.error).toBeUndefined();
  });

  it("JSON-stringifies non-string handler return values", async () => {
    const tool = mockTool("obj", () => ({ ok: true }) as unknown as string);

    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "tool_call", id: "tc_1", name: "obj", input: {} });
      } else if (frame.type === "tool_result") {
        emit.stdout({ type: "done", text: "done", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    await route({ prompt: "test", tools: [tool] });

    const toolResult = fake.stdinFrames.find((f) => f.type === "tool_result")!;
    expect(toolResult.output).toBe(JSON.stringify({ ok: true }));
  });

  it("replies with an error tool_result when the handler throws", async () => {
    const tool = mockTool("boom", () => {
      throw new Error("handler failed");
    });

    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "tool_call", id: "tc_1", name: "boom", input: {} });
      } else if (frame.type === "tool_result") {
        emit.stdout({ type: "done", text: "recovered", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    const result = await route({ prompt: "test", tools: [tool] });

    expect(result.text).toBe("recovered");
    const toolResult = fake.stdinFrames.find((f) => f.type === "tool_result")!;
    expect(toolResult.error).toBe("handler failed");
    expect(toolResult.output).toBeUndefined();
  });

  it("replies with 'unknown tool' error for an unregistered tool_call", async () => {
    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "tool_call", id: "tc_1", name: "ghost", input: {} });
      } else if (frame.type === "tool_result") {
        emit.stdout({ type: "done", text: "done", kind: "pi", sessionId: "s1" });
        emit.close();
      }
    });
    setBridge(fake);

    await route({ prompt: "test", tools: [mockTool("echo", () => "ok")] });

    const toolResult = fake.stdinFrames.find((f) => f.type === "tool_result")!;
    expect(toolResult.error).toBe("unknown tool: ghost");
  });

  it("falls back to the registry on a limit frame", async () => {
    const adapter = new MockAdapter([{ content: "fallback after limit" }]);
    llmRegistry.register(adapter);

    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "limit", message: "rate limited", partial: null });
        emit.close();
      }
    });
    setBridge(fake);

    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("fallback after limit");
    expect(result.kind).toBe("registry-fallback");
    // A non-clean exit must kill the bridge child.
    expect(fake.killed).toBe(true);
  });

  it("falls back to the registry on an error frame", async () => {
    const adapter = new MockAdapter([{ content: "fallback after error" }]);
    llmRegistry.register(adapter);

    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        emit.stdout({ type: "error", message: "boom", partial: null });
        emit.close();
      }
    });
    setBridge(fake);

    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("fallback after error");
    expect(result.kind).toBe("registry-fallback");
  });

  it("falls back to the registry when the stream ends without a terminal frame", async () => {
    const adapter = new MockAdapter([{ content: "fallback no terminal" }]);
    llmRegistry.register(adapter);

    const fake = fakeBridge((frame, emit) => {
      if (frame.type === "run") {
        // Close stdout without emitting a terminal frame.
        emit.close();
      }
    });
    setBridge(fake);

    const result = await route({ prompt: "hello" });

    expect(result.text).toBe("fallback no terminal");
    expect(result.kind).toBe("registry-fallback");
  });
});

// ── Fallback path — no tools ──────────────────────────────────────────────────

describe("route() — fallback path (no tools)", () => {
  it("throws when no adapter is registered", async () => {
    await expect(route({ prompt: "hello" })).rejects.toThrow(
      /seher-bridge unavailable and no LLM adapter registered/,
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
    // input_schema comes from the permissive toInputSchema fallback.
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
