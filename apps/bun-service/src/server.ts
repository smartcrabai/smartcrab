import { dispatch } from "./dispatcher";
import { ensureAdaptersLoaded } from "./registry";
import {
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./types";

/**
 * Line-delimited JSON-RPC server over stdin/stdout.
 *
 * - Reads UTF-8 lines from stdin; each non-empty line must be a JSON-RPC 2.0 request
 * - Writes one JSON response per line to stdout (notifications produce no output)
 * - Logs go to stderr only — never stdout — to keep the wire protocol clean
 * - Exits cleanly when stdin closes or SIGTERM/SIGINT arrives
 */

const log = (...args: unknown[]): void => {
  console.error("[bun-service]", ...args);
};

function writeResponse(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest;
  } catch (err) {
    log("parse error:", err);
    writeResponse({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.PARSE_ERROR,
        message: "Parse error",
      },
    });
    return;
  }

  const response = await dispatch(request);
  if (response !== null) writeResponse(response);
}

let shuttingDown = false;
function shutdown(reason: string, code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutdown: ${reason}`);
  process.nextTick(() => process.exit(code));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main(): Promise<void> {
  log("starting (pid", process.pid + ")");

  await ensureAdaptersLoaded();

  const decoder = new TextDecoder();
  let buffer = "";

  const stdin = Bun.stdin.stream();
  try {
    for await (const chunk of stdin as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        await handleLine(line);
      }
    }
  } catch (err) {
    log("stdin error:", err);
  }

  if (buffer.trim()) await handleLine(buffer);

  shutdown("stdin closed");
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
