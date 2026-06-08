import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { silenceConsoleError } from "./test-helpers.ts";

import modelsHandlers, {
  __setModelsBridgeSpawn,
  type SpawnedModelsBridge,
} from "../commands/models.commands.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * In-process fake of `seher-bridge models <provider>`: pushes a single stdout
 * NDJSON frame then closes, and records the argv + env it was spawned with.
 */
function fakeModelsBridge() {
  const encoder = new TextEncoder();
  let pushStdout!: (obj: unknown) => void;
  let closeStdout!: () => void;
  let killed = false;

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
      controller.close();
    },
  });

  const spawnedArgs: string[][] = [];
  const spawnedEnv: Record<string, string>[] = [];
  const proc: SpawnedModelsBridge = {
    stdout,
    stderr,
    kill: () => {
      killed = true;
      closeStdout();
    },
  };

  return {
    spawn: (_path: string, args: string[], env: Record<string, string>) => {
      spawnedArgs.push(args);
      spawnedEnv.push(env);
      return proc;
    },
    /** Emit one frame then close the stream (the bridge's terminal frame). */
    emitAndClose: (obj: unknown) => {
      pushStdout(obj);
      closeStdout();
    },
    close: () => closeStdout(),
    get killed() {
      return killed;
    },
    spawnedArgs,
    spawnedEnv,
  };
}

const consoleSpy = silenceConsoleError();

beforeEach(() => {
  process.env.SMARTCRAB_SEHER_BRIDGE = "/bin/sh"; // any existing file: resolveBridgePath() must succeed
  consoleSpy.setup();
});

afterEach(() => {
  delete process.env.SMARTCRAB_SEHER_BRIDGE;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  __setModelsBridgeSpawn(null);
  consoleSpy.restore();
});

describe("models.list", () => {
  it("returns the model list and spawns `models <pi-provider>` for copilot", async () => {
    const bridge = fakeModelsBridge();
    __setModelsBridgeSpawn(bridge.spawn);
    bridge.emitAndClose({
      type: "models",
      provider: "github-copilot",
      models: ["gpt-4o", "claude-sonnet-4.5"],
    });

    const result = await modelsHandlers["models.list"]({ kind: "copilot" });

    expect(bridge.spawnedArgs).toEqual([["models", "github-copilot"]]);
    expect(result.models).toEqual(["gpt-4o", "claude-sonnet-4.5"]);
  });

  it("passes the api key / base url to the bridge env for openai", async () => {
    const bridge = fakeModelsBridge();
    __setModelsBridgeSpawn(bridge.spawn);
    bridge.emitAndClose({ type: "models", provider: "openai", models: ["gpt-4o"] });

    await modelsHandlers["models.list"]({
      kind: "openai",
      api_key: "sk-test",
      base_url: "https://example.test/v1",
    });

    expect(bridge.spawnedArgs).toEqual([["models", "openai"]]);
    expect(bridge.spawnedEnv[0]?.OPENAI_API_KEY).toBe("sk-test");
    expect(bridge.spawnedEnv[0]?.OPENAI_BASE_URL).toBe("https://example.test/v1");
  });

  it("passes --refresh to the bridge when refresh is requested", async () => {
    const bridge = fakeModelsBridge();
    __setModelsBridgeSpawn(bridge.spawn);
    bridge.emitAndClose({ type: "models", provider: "openai", models: ["gpt-4o"] });

    await modelsHandlers["models.list"]({ kind: "openai", refresh: true });

    expect(bridge.spawnedArgs).toEqual([["models", "openai", "--refresh"]]);
  });

  it("throws with the bridge message on a models_error frame", async () => {
    const bridge = fakeModelsBridge();
    __setModelsBridgeSpawn(bridge.spawn);
    bridge.emitAndClose({ type: "models_error", message: "token exchange failed" });

    await expect(modelsHandlers["models.list"]({ kind: "copilot" })).rejects.toThrow(
      /token exchange failed/,
    );
    expect(bridge.killed).toBe(true);
  });

  it("rejects unsupported kinds without spawning", async () => {
    const bridge = fakeModelsBridge();
    __setModelsBridgeSpawn(bridge.spawn);

    await expect(modelsHandlers["models.list"]({ kind: "openai-codex" })).rejects.toThrow(
      /unsupported kind/,
    );
    expect(bridge.spawnedArgs).toHaveLength(0);
  });

  it("throws a clear error when the bridge binary cannot be resolved", async () => {
    process.env.SMARTCRAB_SEHER_BRIDGE = "/nonexistent/seher-bridge";

    await expect(modelsHandlers["models.list"]({ kind: "openai" })).rejects.toThrow(
      /seher-bridge binary not found/,
    );
  });
});
