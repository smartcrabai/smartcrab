/**
 * LLM router built on top of the Rust `seher-bridge` sidecar binary.
 *
 * `seher-bridge` (Rust, from https://github.com/smartcrabai/seher) resolves the
 * highest-priority available coding agent — backed by Claude Agent SDK
 * (Anthropic API-compatible), Copilot, or pi-coding-agent (OpenAI
 * API-compatible) — based on the user's YAML config
 * (`$XDG_CONFIG_HOME/smartcrab/seher-config.yaml` by default, overridable via
 * `SMARTCRAB_SEHER_CONFIG`). We spawn the bridge once per request and drive an
 * NDJSON-over-stdio protocol (see the protocol comment below).
 *
 * When the bridge binary cannot be located, spawning fails, or the protocol
 * errors out, we fall back to the first registered adapter in `llmRegistry` so
 * the chat tab stays usable.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { llmRegistry } from "./adapters/llm/registry";
import { defaultSeherConfigPath } from "./seher/write-settings";
import { z } from "zod";
import type { LlmMessage } from "./adapters/llm/types.ts";

/**
 * Tool definition handed to the router by callers (e.g. the chat bubble's
 * `submit_pipeline` tool). Locally typed so we no longer depend on
 * `@seher-ts/sdk`'s types.
 */
export interface SeherTool {
  name: string;
  description: string;
  /** zod v4 ZodObject in practice; typed loosely so test mocks fit. */
  parameters: unknown;
  handler: (input: any) => string | unknown | Promise<string | unknown>;
}

/**
 * Convert a SeherTool's `parameters` (a zod v4 ZodObject) into a JSON Schema.
 * Uses zod v4's native `z.toJSONSchema` — `zod-to-json-schema@3` only
 * understands zod v3 and returns `{}` for v4 schemas. Falls back to a
 * permissive object schema for non-zod inputs (e.g. test mocks).
 */
function toInputSchema(parameters: unknown): Record<string, unknown> {
  try {
    return z.toJSONSchema(parameters as z.ZodType) as Record<string, unknown>;
  } catch {
    return { type: "object", properties: {} };
  }
}

export interface RouteRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  tools?: SeherTool[];
}

export interface RouteResponse {
  text: string;
  /** "pi" from the Rust bridge, or "registry-fallback" when we fall back. */
  kind: string;
}

const MAX_TOOL_ROUNDS = 10;

// ── NDJSON stdio protocol ────────────────────────────────────────────────────
//
// The bridge is spawned once per request. Communication is UTF-8, newline-
// delimited JSON; every object carries a `"type"` discriminator.
//
// bun → bridge (stdin):
//   {"type":"run","prompt":string,"systemPrompt":string|null,"model":string|null,
//    "configPath":string|null,"tools":[{"name","description","parameters":{...JSON Schema...}}]}
//   {"type":"tool_result","id":string,"output":string}
//   {"type":"tool_result","id":string,"error":string}
//
// bridge → bun (stdout):
//   {"type":"tool_call","id":string,"name":string,"input":{}}
//   {"type":"done","text":string,"kind":"pi","sessionId":string}
//   {"type":"limit","message":string,"partial":string|null}
//   {"type":"error","message":string,"partial":string|null}
//
// Exactly one terminal frame (done/limit/error) is emitted; we decide on the
// frame, not the process exit code.

interface RunFrame {
  type: "run";
  prompt: string;
  systemPrompt: string | null;
  model: string | null;
  configPath: string | null;
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
}

/** Minimal shape of `Bun.spawn`'s return value that we depend on. */
interface SpawnedBridge {
  stdin: {
    write(data: string): unknown;
    flush?: () => unknown;
    end?: () => unknown;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill?: (signal?: number) => unknown;
}

export type BridgeSpawn = (bridgePath: string) => SpawnedBridge;

const defaultBridgeSpawn: BridgeSpawn = (bridgePath) =>
  Bun.spawn([bridgePath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as unknown as SpawnedBridge;

let bridgeSpawn: BridgeSpawn = defaultBridgeSpawn;

/**
 * Test-only seam: override how the bridge process is spawned so tests can drive
 * the NDJSON protocol with an in-process fake instead of a real binary. Pass
 * `null` to restore the default `Bun.spawn` behaviour.
 */
export function __setBridgeSpawn(fn: BridgeSpawn | null): void {
  bridgeSpawn = fn ?? defaultBridgeSpawn;
}

/**
 * Locate the `seher-bridge` sidecar binary:
 *   1. `SMARTCRAB_SEHER_BRIDGE` env var (must point at an existing file).
 *   2. Next to the service binary (bundled in the .app Resources).
 *   3. On `PATH` via `Bun.which`.
 * Returns `null` when none resolve, which routes callers to the registry
 * fallback — letting this PR merge before the bridge crate exists.
 */
export function resolveBridgePath(): string | null {
  const fromEnv = process.env.SMARTCRAB_SEHER_BRIDGE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const sibling = join(dirname(process.execPath), "seher-bridge");
  if (existsSync(sibling)) return sibling;

  const onPath = Bun.which("seher-bridge");
  if (onPath) return onPath;

  return null;
}

/** Stream NDJSON lines out of a byte stream, yielding one decoded line at a time. */
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) yield line;
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Forward the bridge's stderr lines to our own logs for diagnostics. */
async function pipeStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const line of readLines(stream)) {
      console.error("[seher-bridge]", line);
    }
  } catch {
    // stderr drain is best-effort; never let it reject the request.
  }
}

/**
 * Drive the NDJSON protocol against a spawned bridge. Resolves with the final
 * text on `done`, throws on `limit`/`error`/spawn failure/protocol violation so
 * the caller's try/catch falls back to the registry adapter.
 */
async function runViaBridge(request: RouteRequest, bridgePath: string): Promise<RouteResponse> {
  const child = bridgeSpawn(bridgePath);

  // Drain stderr in the background for diagnostics.
  void pipeStderr(child.stderr);

  const toolMap = new Map((request.tools ?? []).map((t) => [t.name, t]));

  const runFrame: RunFrame = {
    type: "run",
    prompt: request.prompt,
    systemPrompt: request.systemPrompt ?? null,
    // `maxTokens` is intentionally dropped: the Rust bridge protocol has no
    // such field and current callers don't set it.
    model: request.model ?? null,
    configPath: defaultSeherConfigPath(),
    tools: (request.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toInputSchema(t.parameters),
    })),
  };

  const writeFrame = (obj: unknown): void => {
    child.stdin.write(`${JSON.stringify(obj)}\n`);
    child.stdin.flush?.();
  };

  writeFrame(runFrame);

  // Track clean termination: on any non-`done` exit (limit/error/protocol
  // violation/stream end) we kill the child so a misbehaving bridge that
  // ignores stdin-close doesn't leak one orphaned process per request.
  let finishedCleanly = false;

  try {
    for await (const line of readLines(child.stdout)) {
      let frame: { type?: string; [k: string]: unknown };
      try {
        frame = JSON.parse(line);
      } catch {
        throw new Error(`seher-bridge: invalid JSON frame: ${line}`);
      }

      switch (frame.type) {
        case "tool_call": {
          const id = frame.id as string;
          const name = frame.name as string;
          const input = frame.input;
          const tool = toolMap.get(name);
          if (!tool) {
            writeFrame({ type: "tool_result", id, error: `unknown tool: ${name}` });
            break;
          }
          try {
            const params = tool.parameters as { parse?: (v: unknown) => unknown };
            const parsed = typeof params?.parse === "function" ? params.parse(input) : input;
            const raw = await tool.handler(parsed);
            const output = typeof raw === "string" ? raw : JSON.stringify(raw);
            writeFrame({ type: "tool_result", id, output });
          } catch (err) {
            writeFrame({
              type: "tool_result",
              id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case "done": {
          finishedCleanly = true;
          return { text: (frame.text as string) ?? "", kind: "pi" };
        }
        case "limit":
          throw new Error(`seher-bridge: limit — ${(frame.message as string) ?? "rate limited"}`);
        case "error":
          throw new Error(`seher-bridge: error — ${(frame.message as string) ?? "unknown"}`);
        default:
          throw new Error(`seher-bridge: unexpected frame type: ${String(frame.type)}`);
      }
    }
  } finally {
    // Close stdin so a well-behaved bridge can exit; kill it outright when we
    // bailed without a clean `done` frame.
    child.stdin.end?.();
    if (!finishedCleanly) child.kill?.();
  }

  // stdout ended without a terminal frame.
  throw new Error("seher-bridge: stream ended without a terminal frame");
}

export async function route(request: RouteRequest): Promise<RouteResponse> {
  const bridgePath = resolveBridgePath();
  if (bridgePath) {
    try {
      return await runViaBridge(request, bridgePath);
    } catch (err) {
      console.error("[router] seher-bridge run failed; falling back:", err);
    }
  }

  // Fallback: pick the first registered LLM adapter and call it directly.
  // Used in dev environments without a seher-bridge binary.
  const adapter = llmRegistry.default();
  if (!adapter) {
    throw new Error(
      "router: seher-bridge unavailable and no LLM adapter registered (configure ~/.config/seher/settings.jsonc).",
    );
  }

  const toolDefs = request.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toInputSchema(t.parameters),
  }));

  const toolMap = new Map(request.tools?.map((t) => [t.name, t]) ?? []);
  const messages: LlmMessage[] = [{ role: "user", content: request.prompt }];

  let lastResponse = await adapter.complete({ messages, tools: toolDefs });
  for (let _round = 1; _round < MAX_TOOL_ROUNDS && lastResponse.toolCalls?.length; _round++) {
    if (lastResponse.content) {
      messages.push({ role: "assistant", content: lastResponse.content });
    }

    const results = await Promise.all(
      lastResponse.toolCalls.map(async (call) => {
        const tool = toolMap.get(call.name);
        if (tool) {
          try {
            const parsed = (tool.parameters as { parse: (v: unknown) => unknown }).parse(call.input);
            const raw = await tool.handler(parsed);
            return typeof raw === "string" ? raw : JSON.stringify(raw);
          } catch (err) {
            return `[tool error: ${call.name} - ${err instanceof Error ? err.message : String(err)}]`;
          }
        }
        return `[unknown tool: ${call.name}]`;
      }),
    );
    for (const result of results) {
      messages.push({ role: "tool", content: result });
    }
    lastResponse = await adapter.complete({ messages, tools: toolDefs });
  }

  return { text: lastResponse.content, kind: "registry-fallback" };
}
