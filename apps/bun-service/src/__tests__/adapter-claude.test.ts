import { beforeEach, describe, expect, it } from "bun:test";

import {
  CLAUDE_ADAPTER_ID,
  ClaudeLlmAdapter,
} from "../adapters/llm/claude/index.ts";
import { llmRegistry } from "../adapters/llm/registry.ts";
import type {
  ClaudeSdkClient,
  ClaudeSdkRequest,
  ClaudeSdkResponse,
} from "../adapters/llm/claude/sdk.ts";
import {
  defaultClaudeTools,
  makeGetCurrentSmartcrabConfigTool,
} from "../adapters/llm/claude/tools.ts";

/**
 * Minimal in-memory SDK mock that records the last request and replies with a
 * scripted response.
 */
class MockSdk implements ClaudeSdkClient {
  lastRequest: ClaudeSdkRequest | undefined;
  response: ClaudeSdkResponse = { text: "ok" };

  async query(request: ClaudeSdkRequest): Promise<ClaudeSdkResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

describe("ClaudeLlmAdapter — structure", () => {
  it("declares the canonical adapter id", () => {
    expect(CLAUDE_ADAPTER_ID).toBe("claude");
  });

  it("exposes the documented capabilities", () => {
    const adapter = new ClaudeLlmAdapter({ sdk: new MockSdk() });
    expect(adapter.id).toBe("claude");
    expect(adapter.capabilities).toEqual({
      streaming: true,
      tools: true,
      maxContextTokens: 200_000,
    });
  });

  it("self-registers a default instance with the LLM registry", () => {
    const registered = llmRegistry.get("claude");
    expect(registered).toBeDefined();
    expect(registered?.id).toBe("claude");
    expect(registered?.capabilities.tools).toBe(true);
  });
});

describe("ClaudeLlmAdapter — complete()", () => {
  let sdk: MockSdk;
  let adapter: ClaudeLlmAdapter;

  beforeEach(() => {
    sdk = new MockSdk();
    adapter = new ClaudeLlmAdapter({ sdk });
  });

  it("forwards a single-turn prompt as a user message", async () => {
    sdk.response = { text: "hello world" };

    const resp = await adapter.complete({ prompt: "hi" });

    expect(resp.content).toBe("hello world");
    expect(sdk.lastRequest).toBeDefined();
    expect(sdk.lastRequest?.messages.length).toBe(1);
    expect(sdk.lastRequest?.messages[0]).toEqual({ role: "user", content: "hi" });
    expect(resp.metadata?.["adapter"]).toBe("claude");
  });

  it("preserves multi-turn message history", async () => {
    await adapter.complete({
      messages: [
        { role: "user", content: "ping" },
        { role: "assistant", content: "pong" },
        { role: "user", content: "again?" },
      ],
    });

    expect(sdk.lastRequest?.messages.length).toBe(3);
    expect(sdk.lastRequest?.messages[1]?.role).toBe("assistant");
    expect(sdk.lastRequest?.messages[2]?.content).toBe("again?");
  });

  it("merges built-in tools with caller-supplied tools and forwards them", async () => {
    await adapter.complete({
      prompt: "use a tool",
      tools: [
        {
          name: "echo",
          description: "Echoes the input.",
          input_schema: { type: "object", properties: {} },
        },
      ],
    });

    const forwarded = sdk.lastRequest?.tools ?? [];
    const names = forwarded.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("getCurrentSmartcrabConfig");
  });

  it("propagates tool_use blocks as toolCalls on the response", async () => {
    sdk.response = {
      text: "",
      toolUses: [
        { id: "tu_1", name: "getCurrentSmartcrabConfig", input: {} },
      ],
    };

    const resp = await adapter.complete({ prompt: "config?" });

    expect(resp.toolCalls?.length).toBe(1);
    expect(resp.toolCalls?.[0]?.name).toBe("getCurrentSmartcrabConfig");
    expect(resp.toolCalls?.[0]?.id).toBe("tu_1");
  });

  it("uses caller-supplied options.model when provided", async () => {
    await adapter.complete({
      prompt: "hi",
      options: { model: "claude-opus-4-5" },
    });

    expect(sdk.lastRequest?.model).toBe("claude-opus-4-5");
  });

  it("falls back to the adapter's default model when none is supplied", async () => {
    await adapter.complete({ prompt: "hi" });
    expect(sdk.lastRequest?.model).toMatch(/^claude-/);
  });

  it("rejects requests that have neither prompt nor messages", async () => {
    await expect(adapter.complete({})).rejects.toThrow(
      /must include `prompt` or `messages`/,
    );
  });
});

describe("ClaudeLlmAdapter — tools", () => {
  it("ships the getCurrentSmartcrabConfig tool by default", () => {
    const tools = defaultClaudeTools();
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain("getCurrentSmartcrabConfig");
  });

  it("allows resolving a tool by name", () => {
    const adapter = new ClaudeLlmAdapter({ sdk: new MockSdk() });
    const tool = adapter.resolveTool("getCurrentSmartcrabConfig");
    expect(tool).toBeDefined();
    expect(tool?.definition.name).toBe("getCurrentSmartcrabConfig");
  });

  it("invokes the configured config provider when the tool is called", async () => {
    const tool = makeGetCurrentSmartcrabConfigTool(() => ({
      providers: ["claude", "kimi"],
    }));
    const result = (await tool.handler({})) as { providers: string[] };
    expect(result.providers).toEqual(["claude", "kimi"]);
  });
});

describe("LlmAdapter port — sanity", () => {
  it("registry round-trips a custom adapter", () => {
    const fake = {
      id: "test-fake",
      capabilities: { streaming: false, tools: false, maxContextTokens: 1 },
      async complete() {
        return { content: "" };
      },
    };
    llmRegistry.register(fake);
    expect(llmRegistry.get("test-fake")).toBe(fake);
    expect(llmRegistry.unregister("test-fake")).toBe(true);
    expect(llmRegistry.get("test-fake")).toBeUndefined();
  });
});
