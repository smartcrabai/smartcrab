import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { silenceConsoleError } from "./test-helpers.ts";

import authHandlers, {
  __resetAuthSessions,
  __setBridgeAuthSpawn,
  type SpawnedAuthBridge,
} from "../commands/auth.commands.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * In-process fake of `seher-bridge auth ...`: a queue of stdout NDJSON frames
 * the test pushes (possibly after `auth.start` returned), plus the argv the
 * command spawned it with.
 */
function fakeAuthBridge() {
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
  const proc: SpawnedAuthBridge = {
    stdout,
    stderr,
    kill: () => {
      killed = true;
      closeStdout();
    },
  };

  return {
    spawn: (_path: string, args: string[]) => {
      spawnedArgs.push(args);
      return proc;
    },
    emit: (obj: unknown) => pushStdout(obj),
    close: () => closeStdout(),
    get killed() {
      return killed;
    },
    spawnedArgs,
  };
}

/** Poll `auth.status` until it leaves "pending" (the GUI's loop, accelerated). */
async function waitForTerminal(sessionId: string): Promise<{ state: string; message?: string }> {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const status = authHandlers["auth.status"]({ session_id: sessionId });
    if (status.state !== "pending") return status;
  }
  throw new Error("session never reached a terminal state");
}

const consoleSpy = silenceConsoleError();

beforeEach(() => {
  process.env.SMARTCRAB_SEHER_BRIDGE = "/bin/sh"; // any existing file: resolveBridgePath() must succeed
  consoleSpy.setup();
});

afterEach(() => {
  delete process.env.SMARTCRAB_SEHER_BRIDGE;
  __setBridgeAuthSpawn(null);
  __resetAuthSessions();
  consoleSpy.restore();
});

// ── auth.start ────────────────────────────────────────────────────────────────

describe("auth.start", () => {
  it("device-code flow: returns userCode/verificationUri and spawns auth login github-copilot", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({
      type: "device_code",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=WDJB-MJHT",
      expiresIn: 899,
      interval: 5,
    });

    const result = await authHandlers["auth.start"]({ kind: "copilot" });

    expect(bridge.spawnedArgs).toEqual([["auth", "login", "github-copilot"]]);
    expect(result.flow).toBe("device-code");
    expect(result.user_code).toBe("WDJB-MJHT");
    expect(result.verification_uri).toBe("https://github.com/login/device");
    expect(result.verification_uri_complete).toBe(
      "https://github.com/login/device?user_code=WDJB-MJHT",
    );
    expect(result.expires_in).toBe(899);
    expect(result.session_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("browser flow: returns the authorize url for openai-codex", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "oauth_url", url: "https://auth.openai.com/oauth/authorize?x=1", port: 1455 });

    const result = await authHandlers["auth.start"]({ kind: "openai-codex" });

    expect(bridge.spawnedArgs).toEqual([["auth", "login", "openai-codex"]]);
    expect(result.flow).toBe("browser");
    expect(result.url).toBe("https://auth.openai.com/oauth/authorize?x=1");
  });

  it("throws when the first frame is auth_error", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "auth_error", message: "port 1455 in use" });

    await expect(authHandlers["auth.start"]({ kind: "openai-codex" })).rejects.toThrow(
      /port 1455 in use/,
    );
    expect(bridge.killed).toBe(true);
  });

  it("rejects unsupported kinds without spawning", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);

    await expect(authHandlers["auth.start"]({ kind: "anthropic" })).rejects.toThrow(
      /unsupported kind/,
    );
    expect(bridge.spawnedArgs).toHaveLength(0);
  });

  it("throws a clear error when the bridge binary cannot be resolved", async () => {
    process.env.SMARTCRAB_SEHER_BRIDGE = "/nonexistent/seher-bridge";

    await expect(authHandlers["auth.start"]({ kind: "copilot" })).rejects.toThrow(
      /seher-bridge binary not found/,
    );
  });
});

// ── auth.status ───────────────────────────────────────────────────────────────

describe("auth.status", () => {
  it("reports pending, then done after the bridge emits auth_done", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "device_code", userCode: "X", verificationUri: "u", expiresIn: 60, interval: 1 });

    const { session_id: sessionId } = await authHandlers["auth.start"]({ kind: "copilot" });
    expect(authHandlers["auth.status"]({ session_id: sessionId }).state).toBe("pending");

    bridge.emit({ type: "auth_done", provider: "github-copilot" });
    const terminal = await waitForTerminal(sessionId);
    expect(terminal.state).toBe("done");
  });

  it("reports error with the bridge's message after auth_error", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "device_code", userCode: "X", verificationUri: "u", expiresIn: 60, interval: 1 });

    const { session_id: sessionId } = await authHandlers["auth.start"]({ kind: "copilot" });
    bridge.emit({ type: "auth_error", message: "access denied by the user" });

    const terminal = await waitForTerminal(sessionId);
    expect(terminal.state).toBe("error");
    expect(terminal.message).toMatch(/access denied/);
  });

  it("reports error when the bridge exits without a terminal frame", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "device_code", userCode: "X", verificationUri: "u", expiresIn: 60, interval: 1 });

    const { session_id: sessionId } = await authHandlers["auth.start"]({ kind: "copilot" });
    bridge.close();

    const terminal = await waitForTerminal(sessionId);
    expect(terminal.state).toBe("error");
    expect(terminal.message).toMatch(/without completing/);
  });

  it("deletes the session after delivering a terminal state", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "device_code", userCode: "X", verificationUri: "u", expiresIn: 60, interval: 1 });

    const { session_id: sessionId } = await authHandlers["auth.start"]({ kind: "copilot" });
    bridge.emit({ type: "auth_done", provider: "github-copilot" });
    await waitForTerminal(sessionId);

    expect(() => authHandlers["auth.status"]({ session_id: sessionId })).toThrow(/unknown session/);
  });

  it("throws for unknown session ids", () => {
    expect(() => authHandlers["auth.status"]({ session_id: "nope" })).toThrow(/unknown session/);
  });
});

// ── auth.cancel ───────────────────────────────────────────────────────────────

describe("auth.cancel", () => {
  it("kills the bridge process and forgets the session", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "device_code", userCode: "X", verificationUri: "u", expiresIn: 60, interval: 1 });

    const { session_id: sessionId } = await authHandlers["auth.start"]({ kind: "copilot" });
    const result = authHandlers["auth.cancel"]({ session_id: sessionId });

    expect(result.cancelled).toBe(true);
    expect(bridge.killed).toBe(true);
    expect(() => authHandlers["auth.status"]({ session_id: sessionId })).toThrow(/unknown session/);
  });

  it("is a no-op for unknown sessions", () => {
    expect(authHandlers["auth.cancel"]({ session_id: "nope" }).cancelled).toBe(true);
  });
});

// ── auth.credential-status ────────────────────────────────────────────────────

describe("auth.credential-status", () => {
  it("collects one auth_status frame per provider", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "auth_status", provider: "github-copilot", status: "oauth_valid", expiresInMs: 3_500_000 });
    bridge.emit({ type: "auth_status", provider: "openai-codex", status: "oauth_expired", expiredByMs: 1_000 });
    bridge.emit({ type: "auth_status", provider: "anthropic", status: "api_key" });
    bridge.emit({ type: "auth_status", provider: "openai", status: "none" });
    bridge.close();

    const result = await authHandlers["auth.credential-status"]();

    expect(bridge.spawnedArgs).toEqual([
      ["auth", "status", "github-copilot", "openai-codex", "anthropic", "openai"],
    ]);
    expect(result.bridge_available).toBe(true);
    expect(result.providers["github-copilot"]).toEqual({
      status: "oauth_valid",
      expires_in_ms: 3_500_000,
    });
    expect(result.providers["openai-codex"]).toEqual({
      status: "oauth_expired",
      expired_by_ms: 1_000,
    });
    expect(result.providers["anthropic"]).toEqual({ status: "api_key" });
    expect(result.providers["openai"]).toEqual({ status: "none" });
  });

  it("returns bridgeAvailable=false without spawning when the bridge is missing", async () => {
    process.env.SMARTCRAB_SEHER_BRIDGE = "/nonexistent/seher-bridge";
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);

    const result = await authHandlers["auth.credential-status"]();

    expect(result).toEqual({ bridge_available: false, providers: {} });
    expect(bridge.spawnedArgs).toHaveLength(0);
  });

  it("skips malformed and unrelated frames", async () => {
    const bridge = fakeAuthBridge();
    __setBridgeAuthSpawn(bridge.spawn);
    bridge.emit({ type: "auth_status", provider: "anthropic", status: "api_key" });
    bridge.emit({ type: "something_else" });
    bridge.close();

    const result = await authHandlers["auth.credential-status"]();
    expect(Object.keys(result.providers)).toEqual(["anthropic"]);
  });
});
