import {
  JSON_RPC_ERRORS,
  type CommandHandler,
  type CommandMap,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccess,
} from "./types";

/**
 * Auto-load every `*.commands.ts` file under `./commands/` at build time.
 * Each module's default export must be a `CommandMap` object whose keys are
 * fully-qualified JSON-RPC method names (e.g. `"system.ping"`).
 */
const commandModules = import.meta.glob<{ default: CommandMap }>(
  "./commands/*.commands.ts",
  { eager: true },
);

function buildRegistry(): CommandMap {
  const registry: CommandMap = {};
  for (const [path, mod] of Object.entries(commandModules)) {
    const map = mod?.default;
    if (!map || typeof map !== "object") {
      // eslint-disable-next-line no-console
      console.error(`[dispatcher] skipping ${path}: missing default export`);
      continue;
    }
    for (const [method, handler] of Object.entries(map)) {
      if (typeof handler !== "function") continue;
      if (registry[method]) {
        console.error(
          `[dispatcher] duplicate method "${method}" — overriding from ${path}`,
        );
      }
      registry[method] = handler;
    }
  }
  return registry;
}

const registry: CommandMap = buildRegistry();

/** Register an additional handler at runtime (mostly for tests). */
export function registerCommand(method: string, handler: CommandHandler): void {
  registry[method] = handler;
}

/** Return the list of currently-registered method names. */
export function listMethods(): string[] {
  return Object.keys(registry).sort();
}

function makeError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function makeSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Dispatch a parsed JSON-RPC request and return the response.
 *
 * Returns `null` for valid notifications (requests without an `id`).
 */
export async function dispatch(
  request: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id: JsonRpcId = request.id ?? null;
  const isNotification = request.id === undefined;

  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    if (isNotification) return null;
    return makeError(id, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid Request");
  }

  const handler = registry[request.method];
  if (!handler) {
    if (isNotification) return null;
    return makeError(
      id,
      JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${request.method}`,
    );
  }

  try {
    const result = await handler(request.params);
    if (isNotification) return null;
    return makeSuccess(id, result ?? null);
  } catch (err) {
    if (isNotification) return null;
    const message = err instanceof Error ? err.message : String(err);
    return makeError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, message);
  }
}
