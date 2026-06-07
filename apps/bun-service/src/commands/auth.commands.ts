/**
 * RPC handlers for GUI-driven LLM provider authentication.
 *
 * Methods (RPC params/results use snake_case keys — the Swift client encodes
 * with convertToSnakeCase and decodes with convertFromSnakeCase):
 *   - `auth.start (kind)` -> { session_id, flow, user_code?, verification_uri?,
 *     verification_uri_complete?, expires_in?, url? }
 *   - `auth.status (session_id)` -> { state: "pending"|"done"|"error", message? }
 *   - `auth.cancel (session_id)` -> { cancelled: true }
 *   - `auth.credential-status ()` -> { bridge_available, providers }
 *
 * Each login spawns `seher-bridge auth login <provider>` (see crates/seher-bridge)
 * and relays its NDJSON events: the first frame (`device_code` / `oauth_url`)
 * becomes the `auth.start` result, the terminal frame (`auth_done` /
 * `auth_error`) flips the session state that the GUI polls via `auth.status`.
 * Credentials land in pi's `~/.pi/agent/auth.json`, so subsequent runs need no
 * api key in the YAML config.
 */

import { resolveBridgePath } from "../router.ts";
import { readLines } from "../seher/ndjson.ts";

// ── kinds & providers ────────────────────────────────────────────────────────

/** GUI provider kinds that support an interactive login flow. */
const KIND_TO_PROVIDER: Record<string, string> = {
  copilot: "github-copilot",
  "openai-codex": "openai-codex",
};

/** Providers reported by `auth.credential-status` (pi canonical ids). */
const STATUS_PROVIDERS = ["github-copilot", "openai-codex", "anthropic", "openai"];

/** How long `auth.start` waits for the bridge's first progress frame. */
const START_TIMEOUT_MS = 30_000;
/** How long `auth.credential-status` waits for the status spawn to finish. */
const STATUS_TIMEOUT_MS = 10_000;

// ── bridge spawn seam ────────────────────────────────────────────────────────

/** Minimal shape of `Bun.spawn`'s return value that the auth flows depend on. */
export interface SpawnedAuthBridge {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill?: (signal?: number) => unknown;
}

export type AuthBridgeSpawn = (bridgePath: string, args: string[]) => SpawnedAuthBridge;

const defaultAuthBridgeSpawn: AuthBridgeSpawn = (bridgePath, args) =>
  Bun.spawn([bridgePath, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  }) as unknown as SpawnedAuthBridge;

let authBridgeSpawn: AuthBridgeSpawn = defaultAuthBridgeSpawn;

/**
 * Test-only seam: override how the auth bridge process is spawned so tests can
 * script the NDJSON events in-process. Pass `null` to restore `Bun.spawn`.
 */
export function __setBridgeAuthSpawn(fn: AuthBridgeSpawn | null): void {
  authBridgeSpawn = fn ?? defaultAuthBridgeSpawn;
}

// ── session tracking ─────────────────────────────────────────────────────────

type AuthSessionState = "pending" | "done" | "error";

interface AuthSession {
  proc: SpawnedAuthBridge;
  state: AuthSessionState;
  message?: string;
}

const sessions = new Map<string, AuthSession>();

/** Test-only: drop all sessions (kills any still-pending bridge processes). */
export function __resetAuthSessions(): void {
  for (const session of sessions.values()) {
    session.proc.kill?.();
  }
  sessions.clear();
}

// ── frame parsing ────────────────────────────────────────────────────────────

interface AuthFrame {
  type?: string;
  [k: string]: unknown;
}

function parseFrame(line: string): AuthFrame | null {
  try {
    return JSON.parse(line) as AuthFrame;
  } catch {
    return null;
  }
}

function str(frame: AuthFrame, key: string): string | undefined {
  const v = frame[key];
  return typeof v === "string" ? v : undefined;
}

function num(frame: AuthFrame, key: string): number | undefined {
  const v = frame[key];
  return typeof v === "number" ? v : undefined;
}

/** Forward the bridge's stderr lines to our own logs for diagnostics. */
async function pipeStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const line of readLines(stream)) {
      console.error("[seher-bridge auth]", line);
    }
  } catch {
    // best-effort
  }
}

/** Reject after `ms`, so a hung bridge cannot hang the RPC. */
function timeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ── auth.start ───────────────────────────────────────────────────────────────

interface AuthStartResult {
  session_id: string;
  flow: "device-code" | "browser";
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  url?: string;
}

async function authStart(params: { kind?: string }): Promise<AuthStartResult> {
  const kind = params?.kind;
  const provider = kind ? KIND_TO_PROVIDER[kind] : undefined;
  if (!provider) {
    throw new Error(
      `auth.start: unsupported kind '${kind}' (expected ${Object.keys(KIND_TO_PROVIDER).join(" | ")})`,
    );
  }

  const bridgePath = resolveBridgePath();
  if (!bridgePath) {
    throw new Error(
      "auth.start: seher-bridge binary not found (set SMARTCRAB_SEHER_BRIDGE or rebuild the app bundle)",
    );
  }

  const child = authBridgeSpawn(bridgePath, ["auth", "login", provider]);
  void pipeStderr(child.stderr);

  const lines = readLines(child.stdout)[Symbol.asyncIterator]();

  let first: AuthFrame;
  try {
    const got = await timeout(lines.next(), START_TIMEOUT_MS, "auth.start: first bridge frame");
    if (got.done) throw new Error("auth.start: bridge exited without emitting a frame");
    const frame = parseFrame(got.value);
    if (!frame) throw new Error(`auth.start: malformed bridge frame: ${got.value}`);
    first = frame;
  } catch (err) {
    child.kill?.();
    throw err;
  }

  if (first.type === "auth_error") {
    child.kill?.();
    throw new Error(str(first, "message") ?? "auth.start: login failed");
  }

  let result: Omit<AuthStartResult, "session_id">;
  if (first.type === "device_code") {
    result = {
      flow: "device-code",
      user_code: str(first, "userCode"),
      verification_uri: str(first, "verificationUri"),
      verification_uri_complete: str(first, "verificationUriComplete"),
      expires_in: num(first, "expiresIn"),
    };
  } else if (first.type === "oauth_url") {
    result = { flow: "browser", url: str(first, "url") };
  } else {
    child.kill?.();
    throw new Error(`auth.start: unexpected first frame '${first.type}'`);
  }

  const sessionId = crypto.randomUUID();
  const session: AuthSession = { proc: child, state: "pending" };
  sessions.set(sessionId, session);

  // Drain the remaining frames in the background and flip the session state on
  // the terminal one. A stream that ends without a terminal frame (bridge
  // crash, kill) becomes an error so the GUI never polls forever.
  void (async () => {
    try {
      for (;;) {
        const got = await lines.next();
        if (got.done) break;
        const frame = parseFrame(got.value);
        if (!frame) continue;
        if (frame.type === "auth_done") {
          session.state = "done";
          return;
        }
        if (frame.type === "auth_error") {
          session.state = "error";
          session.message = str(frame, "message") ?? "login failed";
          return;
        }
      }
    } catch {
      // fall through to the no-terminal-frame error below
    }
    if (session.state === "pending") {
      session.state = "error";
      session.message = "seher-bridge exited without completing the login";
    }
  })();

  return { session_id: sessionId, ...result };
}

// ── auth.status / auth.cancel ────────────────────────────────────────────────

function authStatus(params: { session_id?: string }): {
  state: AuthSessionState;
  message?: string;
} {
  const sessionId = params?.session_id;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    throw new Error(`auth.status: unknown session '${sessionId}'`);
  }
  const result = { state: session.state, ...(session.message && { message: session.message }) };
  // Terminal states are delivered exactly once; the GUI stops polling after
  // seeing one, and the entry would otherwise leak.
  if (session.state !== "pending") {
    sessions.delete(sessionId!);
  }
  return result;
}

function authCancel(params: { session_id?: string }): { cancelled: boolean } {
  const sessionId = params?.session_id;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (session) {
    session.proc.kill?.();
    sessions.delete(sessionId!);
  }
  return { cancelled: true };
}

// ── auth.credential-status ───────────────────────────────────────────────────

interface ProviderCredentialStatus {
  status: string;
  expires_in_ms?: number;
  expired_by_ms?: number;
}

interface CredentialStatusResult {
  bridge_available: boolean;
  providers: Record<string, ProviderCredentialStatus>;
}

async function credentialStatus(): Promise<CredentialStatusResult> {
  const bridgePath = resolveBridgePath();
  if (!bridgePath) {
    return { bridge_available: false, providers: {} };
  }

  const child = authBridgeSpawn(bridgePath, ["auth", "status", ...STATUS_PROVIDERS]);
  void pipeStderr(child.stderr);

  const providers: Record<string, ProviderCredentialStatus> = {};
  const collect = (async () => {
    for await (const line of readLines(child.stdout)) {
      const frame = parseFrame(line);
      if (!frame || frame.type !== "auth_status") continue;
      const provider = str(frame, "provider");
      const status = str(frame, "status");
      if (!provider || !status) continue;
      providers[provider] = {
        status,
        // Bridge frames are camelCase; the RPC result is snake_case.
        ...(num(frame, "expiresInMs") !== undefined && { expires_in_ms: num(frame, "expiresInMs") }),
        ...(num(frame, "expiredByMs") !== undefined && { expired_by_ms: num(frame, "expiredByMs") }),
      };
    }
  })();

  try {
    await timeout(collect, STATUS_TIMEOUT_MS, "auth.credential-status");
  } catch (err) {
    child.kill?.();
    throw err;
  }

  return { bridge_available: true, providers };
}

// ── handlers ─────────────────────────────────────────────────────────────────

const handlers = {
  "auth.start": authStart,
  "auth.status": authStatus,
  "auth.cancel": authCancel,
  "auth.credential-status": credentialStatus,
} as const;

export type AuthCommandMap = typeof handlers;
export default handlers;
