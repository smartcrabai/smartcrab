/**
 * TypeScript port of `crates/smartcrab-app/src-tauri/src/engine/dynamic_node.rs`
 * plus the runtime action executor extracted from `commands/execution.rs`.
 *
 * `DynamicNode` is the runtime view of a NodeDefinition (id + name + kind +
 * action). `executeNodeAction` resolves an action against the injected
 * dependencies (LLM registry, chat registry, fetch, shell spawner).
 */

import type {
  NodeAction,
  NodeDefinition,
  NodeKind,
} from "./yaml-schema.ts";

export interface DynamicNode {
  id: string;
  name: string;
  kind: NodeKind;
  action?: NodeAction;
}

export interface LlmRequest {
  prompt: string;
  timeoutSecs?: number;
  metadata?: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
}

export interface LlmAdapter {
  executePrompt(req: LlmRequest): Promise<LlmResponse>;
}

export interface ChatAdapter {
  sendMessage(channelId: string, content: string): Promise<void>;
}

export interface ShellSpawner {
  /** Run `sh -c <command>` and return stdout; throw on non-zero exit/timeout. */
  run(args: {
    command: string;
    cwd?: string;
    timeoutMs: number;
  }): Promise<string>;
}

export interface ExecutorDeps {
  llmRegistry?: Map<string, LlmAdapter>;
  chatRegistry?: Map<string, ChatAdapter>;
  fetch?: typeof globalThis.fetch;
  shell?: ShellSpawner;
}

/** Default shell spawner using Bun.spawn (only if Bun is available). */
export const defaultShellSpawner: ShellSpawner = {
  async run({ command, cwd, timeoutMs }) {
    // `Bun` is provided at runtime in the Bun service; guard for tests.
    const bunAny = (globalThis as { Bun?: unknown }).Bun as
      | {
          spawn: (cmd: string[], opts: { cwd?: string }) => {
            stdout: ReadableStream<Uint8Array>;
            stderr: ReadableStream<Uint8Array>;
            exited: Promise<number>;
            kill: () => void;
          };
        }
      | undefined;
    if (!bunAny) {
      throw new Error("shell action requires Bun runtime");
    }
    const proc = bunAny.spawn(["sh", "-c", command], { cwd });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`command exited with code ${code}: ${stderr}`);
      }
      return await new Response(proc.stdout).text();
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Execute a node's action and return the JSON-shaped output.
 *
 * Mirrors `execute_node_action` from `commands/execution.rs`.
 */
export async function executeNodeAction(
  node: NodeDefinition,
  input: unknown,
  deps: ExecutorDeps,
): Promise<unknown> {
  const action = node.action;
  if (!action) return input;

  switch (action.type) {
    case "shell_command": {
      const shell = deps.shell ?? defaultShellSpawner;
      return await shell.run({
        command: action.command_template,
        cwd: action.working_dir,
        timeoutMs: action.timeout_secs * 1000,
      });
    }
    case "http_request": {
      const fetchFn = deps.fetch ?? globalThis.fetch;
      const res = await fetchFn(action.url_template, {
        method: action.method,
        headers: action.headers,
        body: action.body_template,
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave as text
      }
      return { status_code: res.status, body: parsed };
    }
    case "llm_call": {
      const adapter = deps.llmRegistry?.get(action.provider);
      if (!adapter) {
        throw new Error(`unknown LLM provider: '${action.provider}'`);
      }
      const response = await adapter.executePrompt({
        prompt: action.prompt,
        timeoutSecs: action.timeout_secs,
      });
      return response.content;
    }
    case "chat_send": {
      const adapter = deps.chatRegistry?.get(action.adapter);
      if (!adapter) {
        throw new Error(`unknown chat adapter: '${action.adapter}'`);
      }
      const channel = action.channel_id;
      if (!channel) {
        throw new Error("ChatSend requires a channel_id");
      }
      await adapter.sendMessage(channel, action.content_template);
      return `sent via ${action.adapter} to ${channel}`;
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(
        `unsupported node action: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
