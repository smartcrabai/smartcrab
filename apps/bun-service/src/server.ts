import { setCronStore } from "./commands/cron.commands";
import { configurePipelineCommands } from "./commands/pipeline.commands";
import { configureSettingsCommands } from "./commands/settings.commands";
import { configureSkillsCommands } from "./commands/skills.commands";
import { openDb, runMigrations } from "./db";
import { SqliteCronStore } from "./db/cron";
import { SqlitePipelineDatabase } from "./db/pipelines";
import { BunSqliteSkillsDb } from "./db/skills";
import { rebindSharedToDb } from "./memory/shared-store";
import { SkillsRegistry } from "./skills/registry";
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

  const db = openDb();
  runMigrations(db);
  configurePipelineCommands({
    db: new SqlitePipelineDatabase(db),
    deps: {
      fetch: globalThis.fetch,
    },
  });
  configureSettingsCommands({ db });

  setCronStore(new SqliteCronStore(db));
  configureSkillsCommands({ registry: new SkillsRegistry({ db: new BunSqliteSkillsDb(db) }) });

  // Have the Discord adapter read its config from the chat_adapter_config
  // table (populated by the SwiftUI Settings tab via settings.adapter-save)
  // instead of the env-only literal default.
  //
  // Dynamic import on purpose: importing the discord module at the top of
  // server.ts before the dispatcher has finished walking adapter glob
  // imports triggers a circular-init crash through the LLM registry proxy.
  void import("./adapters/chat/discord").then(({ setDiscordConfigLoader }) => {
    setDiscordConfigLoader(() => {
      const row = db
        .query<{ config_json: string; enabled: number }, [string]>(
          "SELECT config_json, enabled FROM chat_adapter_config WHERE adapter_id = ?1",
        )
        .get("discord");
      if (!row) return null;
      const cfg = JSON.parse(row.config_json) as Record<string, unknown>;
      // Translate the GUI shape (camelCase) to the adapter's expected snake_case.
      return {
        bot_token_env: cfg.botTokenEnv ?? "DISCORD_BOT_TOKEN",
        notification_channel_id: cfg.notificationChannelId,
      };
    });
  });

  // MemoryStore manages its own schema, so it gets its own SQLite handle
  // backed by the same on-disk file (separate connection, separate migration
  // path). When we eventually consolidate the schemas, this can be replaced
  // with `rebindSharedToDb(db)`.
  void rebindSharedToDb;

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
