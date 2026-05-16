import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";

import {
  defaultSeherConfigPath,
  translateToSeherConfig,
  writeSeherConfig,
  type InAppSeherConfig,
} from "../seher/write-settings.ts";

function makeConfig(
  providers: Array<{
    id: string;
    kind: "anthropic" | "copilot" | "openai";
    model?: string;
    envOverrides?: Record<string, string>;
  }>,
  opts?: {
    priorities?: InAppSeherConfig["priorities"];
    fallbackId?: string;
  },
): InAppSeherConfig {
  return {
    providers: providers.map((p) => ({
      ...p,
      model: p.model ?? "",
    })),
    priorities: opts?.priorities ?? [],
    defaults: {
      fallbackProviderId: opts?.fallbackId ?? providers[0]?.id ?? "",
      rateLimitBackoffSeconds: 30,
    },
  };
}

describe("translateToSeherConfig", () => {
  test("anthropic provider → sdk: claude, provider: anthropic", () => {
    const result = translateToSeherConfig(
      makeConfig([{ id: "my-claude", kind: "anthropic", model: "claude-sonnet" }]),
    );
    expect(result.providers["my-claude"]).toEqual({
      provider: "anthropic",
      sdk: "claude",
      models: { build: { model: "claude-sonnet" } },
    });
  });

  test("copilot provider → sdk: copilot, provider: copilot", () => {
    const result = translateToSeherConfig(
      makeConfig([{ id: "my-copilot", kind: "copilot", model: "gpt-4o" }]),
    );
    expect(result.providers["my-copilot"]).toEqual({
      provider: "copilot",
      sdk: "copilot",
      models: { build: { model: "gpt-4o" } },
    });
  });

  test("openai provider → sdk: pi, provider: openai", () => {
    const result = translateToSeherConfig(
      makeConfig([{ id: "my-openai", kind: "openai", model: "gpt-4o" }]),
    );
    expect(result.providers["my-openai"]).toEqual({
      provider: "openai",
      sdk: "pi",
      models: { build: { model: "openai/gpt-4o" } },
    });
  });

  test("openai model with slash is passed through unchanged", () => {
    const result = translateToSeherConfig(
      makeConfig([{ id: "my-openai", kind: "openai", model: "openai/gpt-5" }]),
    );
    expect(result.providers["my-openai"]!.models.build!.model).toBe("openai/gpt-5");
  });

  test("openai with empty model produces empty models object", () => {
    const result = translateToSeherConfig(
      makeConfig([{ id: "my-openai", kind: "openai" }]),
    );
    expect(result.providers["my-openai"]!.models).toEqual({});
  });

  test("OPENAI_API_KEY env override maps to api.key", () => {
    const result = translateToSeherConfig(
      makeConfig([{
        id: "my-openai",
        kind: "openai",
        envOverrides: { OPENAI_API_KEY: "sk-test-key" },
      }]),
    );
    expect(result.providers["my-openai"]!.api).toEqual({ key: "sk-test-key" });
  });

  test("OPENAI_BASE_URL env override maps to api.endpoint", () => {
    const result = translateToSeherConfig(
      makeConfig([{
        id: "my-openai",
        kind: "openai",
        envOverrides: { OPENAI_BASE_URL: "https://custom.api.com/v1" },
      }]),
    );
    expect(result.providers["my-openai"]!.api).toEqual({ endpoint: "https://custom.api.com/v1" });
  });

  test("OPENAI_API_KEY + OPENAI_BASE_URL both map to api", () => {
    const result = translateToSeherConfig(
      makeConfig([{
        id: "my-openai",
        kind: "openai",
        envOverrides: {
          OPENAI_API_KEY: "sk-both",
          OPENAI_BASE_URL: "https://both.example.com/v1",
        },
      }]),
    );
    expect(result.providers["my-openai"]!.api).toEqual({
      key: "sk-both",
      endpoint: "https://both.example.com/v1",
    });
  });

  test("anthropic env overrides do NOT produce api section (only openai)", () => {
    const result = translateToSeherConfig(
      makeConfig([{
        id: "my-claude",
        kind: "anthropic",
        envOverrides: { ANTHROPIC_API_KEY: "sk-ant" },
      }]),
    );
    expect(result.providers["my-claude"]!.api).toBeUndefined();
  });

  test("priority weight maps to per-provider priority", () => {
    const result = translateToSeherConfig(makeConfig(
      [{ id: "a", kind: "anthropic" }],
      { priorities: [{ providerId: "a", weight: 100 }] },
    ));
    expect(result.providers["a"]!.priority).toBe(100);
  });

  test("multiple rules for same provider: max weight wins", () => {
    const result = translateToSeherConfig(makeConfig(
      [{ id: "a", kind: "anthropic" }],
      {
        priorities: [
          { providerId: "a", weight: 10 },
          { providerId: "a", weight: 100 },
          { providerId: "a", weight: 50 },
        ],
      },
    ));
    expect(result.providers["a"]!.priority).toBe(100);
  });

  test("rule for unknown provider is silently dropped", () => {
    const result = translateToSeherConfig(makeConfig(
      [{ id: "real", kind: "anthropic" }],
      { priorities: [{ providerId: "ghost", weight: 999 }] },
    ));
    expect(result.providers["real"]!.priority).toBeUndefined();
  });

  test("multiple providers each get correct entries", () => {
    const result = translateToSeherConfig(makeConfig([
      { id: "c1", kind: "anthropic", model: "claude-3" },
      { id: "c2", kind: "openai", model: "gpt-4o" },
      { id: "c3", kind: "copilot" },
    ]));
    expect(result.providers["c1"]!.sdk).toBe("claude");
    expect(result.providers["c2"]!.sdk).toBe("pi");
    expect(result.providers["c3"]!.sdk).toBe("copilot");
    expect(Object.keys(result.providers)).toHaveLength(3);
  });
});

describe("writeSeherConfig", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "seher-config-test-"));
    configPath = join(tmpDir, "seher-config.yaml");
    process.env.SMARTCRAB_SEHER_CONFIG = configPath;
  });

  afterEach(async () => {
    delete process.env.SMARTCRAB_SEHER_CONFIG;
    await rm(tmpDir, { recursive: true, force: true });
  });

  function readParsed() {
    const raw = readFileSync(configPath, "utf8");
    // Strip banner comment lines
    const yamlContent = raw.split("\n").filter((l) => !l.startsWith("#")).join("\n");
    return YAML.parse(yamlContent);
  }

  test("writes a YAML file at the configured path", () => {
    const cfg = makeConfig([{ id: "main", kind: "anthropic", model: "claude-3" }]);
    writeSeherConfig(cfg);
    expect(existsSync(configPath)).toBe(true);
    const parsed = readParsed();
    expect(parsed.providers.main.sdk).toBe("claude");
    expect(parsed.providers.main.models.build.model).toBe("claude-3");
  });

  test("output file extension is .yaml", () => {
    expect(defaultSeherConfigPath()).toEndWith("seher-config.yaml");
  });

  test("output starts with a banner comment", () => {
    const cfg = makeConfig([{ id: "main", kind: "anthropic" }]);
    writeSeherConfig(cfg);
    const raw = readFileSync(configPath, "utf8");
    expect(raw.startsWith("# Generated by SmartCrab")).toBe(true);
  });

  test("openai provider writes sdk: pi in YAML", () => {
    const cfg = makeConfig([{ id: "gpt", kind: "openai", model: "gpt-4o" }]);
    writeSeherConfig(cfg);
    const parsed = readParsed();
    expect(parsed.providers.gpt.sdk).toBe("pi");
    expect(parsed.providers.gpt.models.build.model).toBe("openai/gpt-4o");
  });

  test("api.key is written into YAML for openai with OPENAI_API_KEY", () => {
    const cfg = makeConfig([{
      id: "gpt",
      kind: "openai",
      envOverrides: { OPENAI_API_KEY: "sk-yaml-test" },
    }]);
    writeSeherConfig(cfg);
    const parsed = readParsed();
    expect(parsed.providers.gpt.api.key).toBe("sk-yaml-test");
  });

  test("api.endpoint is written into YAML for openai with OPENAI_BASE_URL", () => {
    const cfg = makeConfig([{
      id: "gpt",
      kind: "openai",
      envOverrides: { OPENAI_BASE_URL: "https://custom.api.com/v1" },
    }]);
    writeSeherConfig(cfg);
    const parsed = readParsed();
    expect(parsed.providers.gpt.api.endpoint).toBe("https://custom.api.com/v1");
  });

  test("write is idempotent (skip rewrite when content unchanged)", () => {
    const cfg = makeConfig([{ id: "main", kind: "anthropic" }]);
    writeSeherConfig(cfg);
    const firstMtime = readFileSync(configPath, "utf8");
    writeSeherConfig(cfg);
    const secondMtime = readFileSync(configPath, "utf8");
    expect(firstMtime).toBe(secondMtime);
  });

  test("write does NOT inject KIMI_SHARE_DIR into YAML", () => {
    const cfg = makeConfig([{ id: "main", kind: "openai" }]);
    writeSeherConfig(cfg);
    const raw = readFileSync(configPath, "utf8");
    expect(raw).not.toContain("KIMI_SHARE_DIR");
  });

  test("writes multiple providers to YAML", () => {
    const cfg = makeConfig([
      { id: "claude-prod", kind: "anthropic", model: "claude-sonnet" },
      { id: "openai-prod", kind: "openai", model: "gpt-4o", envOverrides: { OPENAI_API_KEY: "sk-test" } },
    ]);
    writeSeherConfig(cfg);
    const parsed = readParsed();
    expect(Object.keys(parsed.providers)).toHaveLength(2);
    expect(parsed.providers["claude-prod"].sdk).toBe("claude");
    expect(parsed.providers["openai-prod"].sdk).toBe("pi");
    expect(parsed.providers["openai-prod"].api.key).toBe("sk-test");
  });
});
