import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isKimiBackedKind,
  kimiShareDirFor,
  removeKimiShare,
  writeKimiShare,
} from "../seher/kimi-share.ts";

describe("isKimiBackedKind", () => {
  test("returns true for kimi and openai", () => {
    expect(isKimiBackedKind("kimi")).toBe(true);
    expect(isKimiBackedKind("openai")).toBe(true);
  });

  test("returns false for anthropic and copilot", () => {
    expect(isKimiBackedKind("anthropic")).toBe(false);
    expect(isKimiBackedKind("copilot")).toBe(false);
  });

  test("returns false for unknown or empty strings", () => {
    expect(isKimiBackedKind("")).toBe(false);
    expect(isKimiBackedKind("unknown")).toBe(false);
  });
});

describe("removeKimiShare", () => {
  let shareRoot: string;

  beforeEach(async () => {
    shareRoot = await mkdtemp(join(tmpdir(), "kimi-share-test-"));
    process.env.SMARTCRAB_KIMI_SHARE_ROOT = shareRoot;
  });

  afterEach(async () => {
    delete process.env.SMARTCRAB_KIMI_SHARE_ROOT;
    await rm(shareRoot, { recursive: true, force: true });
  });

  test("removes the provider directory after writeKimiShare created it", () => {
    writeKimiShare({ providerId: "my-provider", kind: "kimi" });
    const dir = kimiShareDirFor("my-provider");
    expect(existsSync(dir)).toBe(true);

    removeKimiShare("my-provider");

    expect(existsSync(dir)).toBe(false);
  });

  test("is a no-op and does not throw when the directory does not exist", () => {
    const dir = kimiShareDirFor("nonexistent-provider");
    expect(existsSync(dir)).toBe(false);

    expect(() => removeKimiShare("nonexistent-provider")).not.toThrow();
  });

  test("is idempotent — calling twice does not throw", () => {
    writeKimiShare({ providerId: "twice", kind: "openai" });
    removeKimiShare("twice");

    expect(() => removeKimiShare("twice")).not.toThrow();
  });

  test("sanitizes provider ID consistently with writeKimiShare", () => {
    writeKimiShare({ providerId: "my.provider@v2", kind: "kimi" });
    const dir = kimiShareDirFor("my.provider@v2");
    expect(existsSync(dir)).toBe(true);

    removeKimiShare("my.provider@v2");

    expect(existsSync(dir)).toBe(false);
  });
});

describe("writeKimiShare → removeKimiShare round-trip", () => {
  let shareRoot: string;

  beforeEach(async () => {
    shareRoot = await mkdtemp(join(tmpdir(), "kimi-share-rt-"));
    process.env.SMARTCRAB_KIMI_SHARE_ROOT = shareRoot;
  });

  afterEach(async () => {
    delete process.env.SMARTCRAB_KIMI_SHARE_ROOT;
    await rm(shareRoot, { recursive: true, force: true });
  });

  test("kimi provider: write then remove leaves no trace", () => {
    writeKimiShare({ providerId: "kimi-prov", kind: "kimi" });
    expect(existsSync(kimiShareDirFor("kimi-prov"))).toBe(true);

    removeKimiShare("kimi-prov");

    expect(existsSync(kimiShareDirFor("kimi-prov"))).toBe(false);
  });

  test("openai provider: write then remove leaves no trace", () => {
    writeKimiShare({ providerId: "openai-prov", kind: "openai" });
    expect(existsSync(kimiShareDirFor("openai-prov"))).toBe(true);

    removeKimiShare("openai-prov");

    expect(existsSync(kimiShareDirFor("openai-prov"))).toBe(false);
  });

  test("removing one provider does not affect a sibling provider's directory", () => {
    writeKimiShare({ providerId: "prov-a", kind: "kimi" });
    writeKimiShare({ providerId: "prov-b", kind: "openai" });

    removeKimiShare("prov-a");

    expect(existsSync(kimiShareDirFor("prov-a"))).toBe(false);
    expect(existsSync(kimiShareDirFor("prov-b"))).toBe(true);
  });
});
