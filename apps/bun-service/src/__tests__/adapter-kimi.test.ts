import { describe, expect, test, beforeEach } from "bun:test";

import {
  KimiLlmAdapter,
  resolveKimiSdk,
} from "../adapters/llm/kimi/index.ts";
import { mockKimiSdk, type KimiSdkLike } from "../adapters/llm/kimi/mock.ts";
import {
  clearLlmAdapters,
  getLlmAdapter,
  registerLlmAdapter,
} from "../adapters/llm/registry.ts";

describe("KimiLlmAdapter", () => {
  beforeEach(() => {
    clearLlmAdapters();
  });

  test("id, name, and capabilities are correct", () => {
    const adapter = new KimiLlmAdapter({ sdk: mockKimiSdk });
    expect(adapter.id).toBe("kimi");
    expect(adapter.name).toBe("Kimi");
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.tools).toBe(true);
    expect(adapter.capabilities.native).toBe("kimi");
  });

  test("executePrompt routes through the SDK Session", async () => {
    const adapter = new KimiLlmAdapter({ sdk: mockKimiSdk });
    const res = await adapter.executePrompt({ prompt: "hello" });
    expect(res.content).toBe("[kimi-mock] hello");
    expect(res.metadata).toEqual({ mock: true });
  });

  test("streamPrompt falls back to executePrompt", async () => {
    const adapter = new KimiLlmAdapter({ sdk: mockKimiSdk });
    const res = await adapter.streamPrompt({ prompt: "yo" });
    expect(res.content).toBe("[kimi-mock] yo");
  });

  test("uses injected SDK rather than dynamic resolution", async () => {
    let constructed = 0;
    const fakeSdk: KimiSdkLike = {
      Session: class {
        constructor() {
          constructed += 1;
        }
        async run(prompt: string) {
          return { content: `fake:${prompt}` };
        }
      },
    };
    const adapter = new KimiLlmAdapter({ sdk: fakeSdk });
    const res = await adapter.executePrompt({ prompt: "x" });
    expect(constructed).toBe(1);
    expect(res.content).toBe("fake:x");
  });

  test("times out per request.timeoutSecs", async () => {
    const slowSdk: KimiSdkLike = {
      Session: class {
        run(_p: string) {
          return new Promise<{ content: string }>(() => {
            /* never resolves */
          });
        }
      },
    };
    const adapter = new KimiLlmAdapter({ sdk: slowSdk });
    const start = Date.now();
    await expect(
      adapter.executePrompt({ prompt: "x", timeoutSecs: 0.05 }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("self-registers via registry helper", () => {
    // Mimic the side effect of `import "../adapters/llm/kimi"`.
    registerLlmAdapter(new KimiLlmAdapter({ sdk: mockKimiSdk }));
    const fromRegistry = getLlmAdapter("kimi");
    expect(fromRegistry).toBeDefined();
    expect(fromRegistry?.id).toBe("kimi");
  });

  test("resolveKimiSdk falls back to mock when no real SDK present", async () => {
    const sdk = await resolveKimiSdk();
    expect(typeof sdk.Session).toBe("function");
    const session = new sdk.Session();
    const out = await session.run("ping");
    expect(out.content).toContain("ping");
  });
});
