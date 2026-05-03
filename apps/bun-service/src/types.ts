/**
 * Minimal inline JSON-RPC types.
 *
 * These are intentionally inlined so the bun-service can build
 * before `@smartcrab/ipc-protocol` (Unit 2) is published. When
 * that package is available the types below should be replaced
 * with imports from it.
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export type CommandHandler = (params?: unknown) => unknown | Promise<unknown>;
export type CommandMap = Record<string, CommandHandler>;

/** Standard JSON-RPC error codes. */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
