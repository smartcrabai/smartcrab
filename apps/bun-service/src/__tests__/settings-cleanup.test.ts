import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../db/index.ts";
import {
  configureSettingsCommands,
  default as handlers,
} from "../commands/settings.commands.ts";
import { kimiShareDirFor } from "../seher/kimi-share.ts";
import type { InAppSeherConfig } from "../seher/write-settings.ts";

function makeConfig(
  providers: Array<{ id: string; kind: string; model: string }>,
): InAppSeherConfig {
  return {
    providers: providers as InAppSeherConfig["providers"],
    priorities: [],
    defaults: {
      fallbackProviderId: providers[0]?.id ?? "",
      rateLimitBackoffSeconds: 5,
    },
  };
}

describe("settings.app-save – kimi share directory cleanup", () => {
  let shareRoot: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(async () => {
    shareRoot = await mkdtemp(join(tmpdir(), "kimi-share-cmd-"));
    process.env.SMARTCRAB_KIMI_SHARE_ROOT = shareRoot;
    // Redirect seher-settings.jsonc to a temp path so writeSeherSettings does not fail
    process.env.SMARTCRAB_SEHER_CONFIG = join(shareRoot, "seher-settings.jsonc");

    db = openDb({ path: ":memory:" });
    configureSettingsCommands({ db });
  });

  afterEach(async () => {
    db.close();
    delete process.env.SMARTCRAB_KIMI_SHARE_ROOT;
    delete process.env.SMARTCRAB_SEHER_CONFIG;
    await rm(shareRoot, { recursive: true, force: true });
  });

  test("deleting a kimi provider removes its share directory", () => {
    handlers["settings.app-save"]({
      config: makeConfig([{ id: "my-kimi", kind: "kimi", model: "k1-mini" }]),
    });
    expect(existsSync(kimiShareDirFor("my-kimi"))).toBe(true);

    handlers["settings.app-save"]({ config: makeConfig([]) });

    expect(existsSync(kimiShareDirFor("my-kimi"))).toBe(false);
  });

  test("deleting an openai provider removes its share directory", () => {
    handlers["settings.app-save"]({
      config: makeConfig([{ id: "my-openai", kind: "openai", model: "gpt-4o" }]),
    });
    expect(existsSync(kimiShareDirFor("my-openai"))).toBe(true);

    handlers["settings.app-save"]({ config: makeConfig([]) });

    expect(existsSync(kimiShareDirFor("my-openai"))).toBe(false);
  });

  test("deleting an anthropic provider does not touch any kimi share directory", () => {
    handlers["settings.app-save"]({
      config: makeConfig([
        { id: "kimi-1", kind: "kimi", model: "k1" },
        { id: "anthropic-1", kind: "anthropic", model: "claude-3-7-sonnet" },
      ]),
    });
    expect(existsSync(kimiShareDirFor("kimi-1"))).toBe(true);

    handlers["settings.app-save"]({
      config: makeConfig([{ id: "kimi-1", kind: "kimi", model: "k1" }]),
    });

    expect(existsSync(kimiShareDirFor("kimi-1"))).toBe(true);
  });

  test("removing a kimi provider preserves an openai provider's share directory", () => {
    handlers["settings.app-save"]({
      config: makeConfig([
        { id: "kimi-a", kind: "kimi", model: "k1" },
        { id: "openai-b", kind: "openai", model: "gpt-4o" },
      ]),
    });

    handlers["settings.app-save"]({
      config: makeConfig([{ id: "openai-b", kind: "openai", model: "gpt-4o" }]),
    });

    expect(existsSync(kimiShareDirFor("kimi-a"))).toBe(false);
    expect(existsSync(kimiShareDirFor("openai-b"))).toBe(true);
  });

  test("first save with no prior config in DB does not throw", () => {
    expect(() =>
      handlers["settings.app-save"]({
        config: makeConfig([{ id: "fresh-kimi", kind: "kimi", model: "k1" }]),
      }),
    ).not.toThrow();
  });
});
