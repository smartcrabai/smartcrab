import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../db/index.ts";
import {
  configureSettingsCommands,
  default as handlers,
} from "../commands/settings.commands.ts";
import { writeSeherConfig, type InAppSeherConfig } from "../seher/write-settings.ts";

function makeConfig(
  providers: Array<{ id: string; kind: "anthropic" | "copilot" | "openai"; model?: string }>,
): InAppSeherConfig {
  return {
    providers: providers.map((p) => ({ ...p, model: p.model ?? "" })),
    priorities: [],
    defaults: {
      fallbackProviderId: providers[0]?.id ?? "",
      rateLimitBackoffSeconds: 5,
    },
  };
}

describe("settings.app-save — DB persistence", () => {
  let db: ReturnType<typeof openDb>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "settings-db-test-"));
    const seherConfigPath = join(tmpDir, "seher-config.yaml");
    db = openDb({ path: ":memory:" });
    configureSettingsCommands({ db, seherConfigPath });
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("first save with no prior config does not throw", () => {
    expect(() =>
      handlers["settings.app-save"]({
        config: makeConfig([{ id: "fresh", kind: "openai", model: "gpt-4o" }]),
      }),
    ).not.toThrow();
  });

  test("load returns saved config", () => {
    const cfg = makeConfig([{ id: "main", kind: "anthropic", model: "claude-3" }]);
    handlers["settings.app-save"]({ config: cfg });
    const loaded = handlers["settings.app-load"]() as InAppSeherConfig | null;
    expect(loaded).not.toBeNull();
    expect(loaded!.providers).toHaveLength(1);
    expect(loaded!.providers[0]!.id).toBe("main");
    expect(loaded!.providers[0]!.kind).toBe("anthropic");
  });

  test("re-saving overwrites previous config", () => {
    handlers["settings.app-save"]({
      config: makeConfig([{ id: "first", kind: "anthropic" }]),
    });
    handlers["settings.app-save"]({
      config: makeConfig([{ id: "second", kind: "openai" }]),
    });
    const loaded = handlers["settings.app-load"]() as InAppSeherConfig | null;
    expect(loaded!.providers[0]!.id).toBe("second");
  });
});

describe("writeSeherConfig via settings handler (with isolated path)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "settings-file-test-"));
    configPath = join(tmpDir, "seher-config.yaml");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("writes YAML file with correct sdk:pi for openai provider", () => {
    const cfg = makeConfig([{ id: "gpt", kind: "openai", model: "gpt-4o" }]);
    writeSeherConfig(cfg, configPath);
    const raw = readFileSync(configPath, "utf8");
    expect(raw).toContain("sdk: pi");
    expect(raw).toContain("openai/gpt-4o");
  });

  test("writes YAML file for anthropic provider", () => {
    const cfg = makeConfig([{ id: "claude", kind: "anthropic", model: "claude-3" }]);
    writeSeherConfig(cfg, configPath);
    const raw = readFileSync(configPath, "utf8");
    expect(raw).toContain("sdk: pi");
    expect(raw).toContain("anthropic/claude-3");
  });

  test("does not write KIMI_SHARE_DIR into YAML", () => {
    const cfg = makeConfig([{ id: "main", kind: "openai" }]);
    writeSeherConfig(cfg, configPath);
    const raw = readFileSync(configPath, "utf8");
    expect(raw).not.toContain("KIMI_SHARE_DIR");
  });

  test("no kimi-share directory is created anywhere", () => {
    const cfg = makeConfig([
      { id: "k1", kind: "anthropic" },
      { id: "k2", kind: "openai" },
      { id: "k3", kind: "copilot" },
    ]);
    writeSeherConfig(cfg, configPath);
    expect(existsSync(join(tmpDir, "kimi-share"))).toBe(false);
  });

  test("write is idempotent (same content produces identical output)", () => {
    const cfg = makeConfig([{ id: "stable", kind: "anthropic", model: "claude-3" }]);
    writeSeherConfig(cfg, configPath);
    const first = readFileSync(configPath, "utf8");
    writeSeherConfig(cfg, configPath);
    const second = readFileSync(configPath, "utf8");
    expect(first).toBe(second);
  });

  test("removing a provider and re-saving does not error", () => {
    const cfgAll = makeConfig([
      { id: "a", kind: "anthropic" },
      { id: "b", kind: "openai" },
    ]);
    writeSeherConfig(cfgAll, configPath);
    expect(existsSync(configPath)).toBe(true);

    const cfgOne = makeConfig([{ id: "a", kind: "anthropic" }]);
    expect(() => writeSeherConfig(cfgOne, configPath)).not.toThrow();
  });
});
