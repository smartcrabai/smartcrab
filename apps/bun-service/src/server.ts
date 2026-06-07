import { setCronStore, setCronJobCallback } from "./commands/cron.commands";
import { bootstrapCronRunner } from "./cron/runner";
import { CronScheduler } from "./cron/scheduler";
import { configurePipelineCommands } from "./commands/pipeline.commands";
import {
  configurePipelineAuthorCommands,
  makeDbProviderLister,
} from "./commands/pipeline-author.commands";
import { configureChatPairingCommands } from "./commands/chat-pairing.commands";
import { configureSettingsCommands } from "./commands/settings.commands";
import { defaultSeherConfigPath } from "./seher/write-settings";
import { configureSkillsCommands } from "./commands/skills.commands";
import { openDb, runMigrations } from "./db";
import { SqliteCronStore } from "./db/cron";
import { SqlitePipelineDatabase } from "./db/pipelines";
import { BunSqliteSkillsDb } from "./db/skills";
import { createSqlitePairingStore, setPairingStore } from "./adapters/chat/pairing-store";
import { rebindSharedToDb } from "./memory/shared-store";
import { SkillsRegistry } from "./skills/registry";
import { dispatch } from "./dispatcher";
import { chatRegistry, ensureAdaptersLoaded } from "./registry";
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
  // Pipeline llm_call nodes route through the seher-bridge Rust binary so
  // the same multi-provider auto-resolution that powers chat-bubble drives
  // pipeline execution. Register the bridge under every provider id we
  // care about — the actual agent is picked by seher-bridge at run time
  // based on the user's settings.
  const { route: routePrompt } = await import("./router");
  const seherLlmAdapter = {
    async executePrompt(req: { prompt: string; timeoutSecs?: number }) {
      const result = await routePrompt({ prompt: req.prompt });
      return { content: result.text };
    },
  };
  const llmRegistry = new Map<string, typeof seherLlmAdapter>();
  for (const id of ["seher", "default", "anthropic", "copilot", "openai"]) {
    llmRegistry.set(id, seherLlmAdapter);
  }

  configurePipelineCommands({
    db: new SqlitePipelineDatabase(db),
    deps: {
      fetch: globalThis.fetch,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmRegistry: llmRegistry as any,
    },
  });
  configureSettingsCommands({ db, seherConfigPath: defaultSeherConfigPath() });
  configurePipelineAuthorCommands({
    listProviders: makeDbProviderLister(db),
    listChatAdapters: () => chatRegistry.list(),
  });

  const pairingStore = createSqlitePairingStore(db);
  setPairingStore(pairingStore);
  configureChatPairingCommands({ store: pairingStore });

  const cronStore = new SqliteCronStore(db);
  setCronStore(cronStore);
  // Cron firing → pipeline.execute. Runs in the same process so the executor's
  // ExecutorDeps (with the seher-bridge LLM router) is available.
  const cronCallback = (job: { id: string; pipeline_id: string }) => async () => {
    cronStore.markRun(job.id, new Date().toISOString());
    try {
      const { default: pipelineHandlers } = await import("./commands/pipeline.commands");
      await pipelineHandlers["pipeline.execute"]({ id: job.pipeline_id });
    } catch (err) {
      console.error(`[cron] job ${job.id} pipeline.execute failed:`, err);
    }
  };
  setCronJobCallback(cronCallback);
  bootstrapCronRunner({
    store: cronStore,
    scheduler: new CronScheduler(),
    callback: cronCallback,
  });
  configureSkillsCommands({ registry: new SkillsRegistry({ db: new BunSqliteSkillsDb(db) }) });

  // Dynamic import: chat-bubble.commands → router → llmRegistry proxy
  // triggers a circular init when statically imported here, same as the
  // discord adapter wiring above.
  void import("./commands/chat-bubble.commands").then(({ configureChatBubbleCommands }) => {
    configureChatBubbleCommands({ db });
  });

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
      // Token is supplied per-call from the macOS Keychain via
      // `chat.start({ token })`; only non-secret knobs live here.
      return { dm_policy: cfg.dmPolicy };
    });
  });

  // Migration 005-memory-realign aligned the on-disk memory schema with
  // MemoryStore's expected shape (id INTEGER, content/metadata + FTS5 on
  // content), so we can now bind the shared store to the main app DB.
  rebindSharedToDb(db);

  // Wire the seher-bridge router as the summarizer LLM and run the hermes-style learn
  // loop every 30 minutes. Dynamic-import for the same circular-init
  // reason chat-bubble / discord / pipeline.execute use it.
  void import("./commands/memory.commands").then(({ configureMemorySummarizer }) => {
    configureMemorySummarizer({
      async complete(prompt: string) {
        const r = await routePrompt({ prompt });
        return r.text;
      },
    });
  });
  setInterval(async () => {
    try {
      const { runLearnLoop } = await import("./memory/learner");
      const { getSharedMemoryStore } = await import("./memory/shared-store");
      const result = await runLearnLoop({
        store: getSharedMemoryStore(),
        llm: { async complete(prompt: string) { const r = await routePrompt({ prompt }); return r.text; } },
        windowSize: 50,
        minEntries: 5,
      });
      if (result.summarized > 0) {
        log(`learn-loop: summarized ${result.summarized} entries`);
      }
    } catch (err) {
      log("learn-loop error:", err);
    }
  }, 30 * 60_000);

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
