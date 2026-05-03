/**
 * JSON-RPC 2.0 envelope types.
 *
 * @see https://www.jsonrpc.org/specification
 */

/** JSON-RPC 2.0 protocol version literal. */
export const JSONRPC_VERSION = "2.0" as const;
export type JsonRpcVersion = typeof JSONRPC_VERSION;

/** A JSON-RPC id (string, number, or null). */
export type JsonRpcId = string | number | null;

/** Standard JSON-RPC error codes. */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** Server error range start (inclusive). */
  ServerErrorStart: -32099,
  /** Server error range end (inclusive). */
  ServerErrorEnd: -32000,
} as const;

export interface JsonRpcError<TData = unknown> {
  code: number;
  message: string;
  data?: TData;
}

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: JsonRpcVersion;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorResponse<TData = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  error: JsonRpcError<TData>;
}

export type JsonRpcResponse<TResult = unknown, TErrorData = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse<TErrorData>;

/** Type guard: is the value a successful response? */
export function isJsonRpcSuccess<TResult, TErr>(
  resp: JsonRpcResponse<TResult, TErr>,
): resp is JsonRpcSuccessResponse<TResult> {
  return "result" in resp;
}

/** Type guard: is the value an error response? */
export function isJsonRpcError<TResult, TErr>(
  resp: JsonRpcResponse<TResult, TErr>,
): resp is JsonRpcErrorResponse<TErr> {
  return "error" in resp;
}

/** Construct a request envelope. */
export function makeRequest<TParams>(
  id: JsonRpcId,
  method: string,
  params?: TParams,
): JsonRpcRequest<TParams> {
  const req: JsonRpcRequest<TParams> = {
    jsonrpc: JSONRPC_VERSION,
    id,
    method,
  };
  if (params !== undefined) {
    req.params = params;
  }
  return req;
}

/** Construct a notification envelope (no id, no response expected). */
export function makeNotification<TParams>(
  method: string,
  params?: TParams,
): JsonRpcNotification<TParams> {
  const note: JsonRpcNotification<TParams> = {
    jsonrpc: JSONRPC_VERSION,
    method,
  };
  if (params !== undefined) {
    note.params = params;
  }
  return note;
}

/** Construct a success response envelope. */
export function makeSuccessResponse<TResult>(
  id: JsonRpcId,
  result: TResult,
): JsonRpcSuccessResponse<TResult> {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

/** Construct an error response envelope. */
export function makeErrorResponse<TData = unknown>(
  id: JsonRpcId,
  error: JsonRpcError<TData>,
): JsonRpcErrorResponse<TData> {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}
