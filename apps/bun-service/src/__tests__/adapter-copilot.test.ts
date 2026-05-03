import { describe, expect, test, beforeEach } from "bun:test";

import {
  CopilotLlmAdapter,
  resolveCopilotSdk,
} from "../adapters/llm/copilot/index.ts";
import {
  mockCopilotSdk,
  type CopilotSdkLike,
} from "../adapters/llm/copilot/mock.ts";
import {
  clearLlmAdapters,
  getLlmAdapter,
  registerLlmAdapter,
} from "../adapters/llm/registry.ts";

describe("CopilotLlmAdapter", () => {
  beforeEach(() => {
    clearLlmAdapters();
  });

  test("id, name, and capabilities are correct", () => {
    const adapter = new CopilotLlmAdapter({ sdk: mockCopilotSdk });
    expect(adapter.id).toBe("copilot");
    expect(adapter.name).toBe("GitHub Copilot");
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.tools).toBe(true);
    // JSON-RPC + MCP signal for downstream tool routing.
    expect(adapter.capabilities.native).toBe("copilot");
  });

  test("executePrompt issues JSON-RPC chat.complete and unwraps result", async () => {
    let lastMethod: string | undefined;
    let lastParams: Record<string, unknown> | undefined;
    const sdk: CopilotSdkLike = {
      Client: class {
        constructor(_opts?: unknown) {}
        async request(method: string, params?: Record<string, unknown>) {
          lastMethod = method;
          lastParams = params;
          return { result: { content: "hi", metadata: { source: "rpc" } } };
        }
      },
    };
    const adapter = new CopilotLlmAdapter({ sdk });
    const res = await adapter.executePrompt({
      prompt: "how are you",
      metadata: { trace: "abc" },
    });
    expect(lastMethod).toBe("chat.complete");
    expect(lastParams).toEqual({
      prompt: "how are you",
      metadata: { trace: "abc" },
    });
    expect(res.content).toBe("hi");
    expect(res.metadata).toEqual({ source: "rpc" });
  });

  test("propagates JSON-RPC error envelope as a thrown Error", async () => {
    const sdk: CopilotSdkLike = {
      Client: class {
        async request() {
          return { error: { code: -32000, message: "boom" } };
        }
      },
    };
    const adapter = new CopilotLlmAdapter({ sdk });
    await expect(
      adapter.executePrompt({ prompt: "x" }),
    ).rejects.toThrow(/copilot: rpc error -32000: boom/);
  });

  test("throws when result is empty", async () => {
    const sdk: CopilotSdkLike = {
      Client: class {
        async request() {
          return {};
        }
      },
    };
    const adapter = new CopilotLlmAdapter({ sdk });
    await expect(adapter.executePrompt({ prompt: "x" })).rejects.toThrow(
      /empty result/,
    );
  });

  test("times out per request.timeoutSecs", async () => {
    const sdk: CopilotSdkLike = {
      Client: class {
        request() {
          return new Promise<{ result: { content: string } }>(() => {
            /* never resolves */
          });
        }
      },
    };
    const adapter = new CopilotLlmAdapter({ sdk });
    const start = Date.now();
    await expect(
      adapter.executePrompt({ prompt: "x", timeoutSecs: 0.05 }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("streamPrompt falls back to executePrompt", async () => {
    const adapter = new CopilotLlmAdapter({ sdk: mockCopilotSdk });
    const res = await adapter.streamPrompt({ prompt: "yo" });
    expect(res.content).toBe("[copilot-mock] yo");
  });

  test("self-registers via registry helper", () => {
    registerLlmAdapter(new CopilotLlmAdapter({ sdk: mockCopilotSdk }));
    const fromRegistry = getLlmAdapter("copilot");
    expect(fromRegistry).toBeDefined();
    expect(fromRegistry?.id).toBe("copilot");
  });

  test("resolveCopilotSdk falls back to mock when no real SDK present", async () => {
    const sdk = await resolveCopilotSdk();
    expect(typeof sdk.Client).toBe("function");
    const client = new sdk.Client();
    const res = await client.request<{ content: string }>("chat.complete", {
      prompt: "ping",
    });
    expect(res.result?.content).toContain("ping");
  });
});
