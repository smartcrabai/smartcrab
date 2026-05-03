import { loadCommandModules } from "./_loaders";
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

let registryPromise: Promise<CommandMap> | null = null;
const overrides: CommandMap = {};

function getRegistry(): Promise<CommandMap> {
  if (!registryPromise) {
    registryPromise = loadCommandModules().catch((err) => {
      console.error("[dispatcher] failed to load commands:", err);
      return {} as CommandMap;
    });
  }
  return registryPromise;
}

/** Register an additional handler at runtime (mostly for tests). */
export function registerCommand(method: string, handler: CommandHandler): void {
  overrides[method] = handler;
}

/** Return the list of currently-registered method names. */
export async function listMethods(): Promise<string[]> {
  const registry = await getRegistry();
  return [...new Set([...Object.keys(registry), ...Object.keys(overrides)])].sort();
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

  const registry = await getRegistry();
  const handler = overrides[request.method] ?? registry[request.method];
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
