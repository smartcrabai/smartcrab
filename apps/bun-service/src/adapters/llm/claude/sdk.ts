/**
 * Thin shim around `@anthropic-ai/claude-agent-sdk` so the adapter stays
 * testable and the SDK can be swapped or mocked without touching call sites.
 *
 * The upstream module is imported dynamically so a missing dependency only
 * surfaces when `query()` actually runs — not at import time.
 */

export interface ClaudeSdkRequest {
  readonly model?: string;
  readonly system?: string;
  readonly messages: ReadonlyArray<{
    readonly role: "user" | "assistant";
    readonly content: string;
  }>;
  readonly tools?: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly input_schema: Record<string, unknown>;
  }>;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

export interface ClaudeSdkResponse {
  readonly text: string;
  readonly toolUses?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
  }>;
}

export interface ClaudeSdkClient {
  query(request: ClaudeSdkRequest): Promise<ClaudeSdkResponse>;
}

interface SdkContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface SdkEvent {
  type?: string;
  message?: { content?: SdkContentBlock[] };
}

interface SdkModule {
  query?: (opts: {
    prompt: string;
    options?: Record<string, unknown>;
  }) => AsyncIterable<SdkEvent>;
}

/**
 * Locate the Claude Code CLI on the host so the agent SDK can spawn it.
 *
 * The SDK normally derives `pathToClaudeCodeExecutable` from
 * `import.meta.url + "../cli.js"`, which resolves to a bunfs virtual path
 * (`/$bunfs/root/cli.js`) inside a `bun build --compile` binary and fails
 * to spawn. Resolving against the host PATH is the canonical fix and also
 * keeps the user's Claude Pro / Max subscription (the API-key path on
 * `@anthropic-ai/sdk` does not).
 *
 * Override order:
 *   1. `SMARTCRAB_CLAUDE_PATH` env var (explicit pin)
 *   2. `Bun.which("claude")` — picks up `~/.local/bin/claude`,
 *      Homebrew, npm-global, etc.
 */
function resolveClaudeExecutable(): string {
  const override = process.env.SMARTCRAB_CLAUDE_PATH;
  if (override) return override;
  const found = Bun.which("claude");
  if (found) return found;
  throw new Error(
    "Claude Code CLI not found in PATH. Install via `npm i -g @anthropic-ai/claude-code` " +
      "or set SMARTCRAB_CLAUDE_PATH to the absolute path of the binary.",
  );
}

export class DefaultClaudeSdkClient implements ClaudeSdkClient {
  async query(request: ClaudeSdkRequest): Promise<ClaudeSdkResponse> {
    let sdk: SdkModule;
    try {
      sdk = (await import("@anthropic-ai/claude-agent-sdk")) as SdkModule;
    } catch (cause) {
      throw new Error(
        "@anthropic-ai/claude-agent-sdk is not installed. Run `bun install` " +
          "in apps/bun-service before invoking the Claude adapter.",
        { cause: cause as Error },
      );
    }

    if (typeof sdk.query !== "function") {
      throw new Error(
        "@anthropic-ai/claude-agent-sdk did not expose a `query` function.",
      );
    }

    const pathToClaudeCodeExecutable = resolveClaudeExecutable();

    let text = "";
    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const event of sdk.query({
      prompt: renderPrompt(request),
      options: {
        model: request.model,
        system: request.system,
        tools: request.tools,
        maxTokens: request.maxTokens,
        pathToClaudeCodeExecutable,
      },
    })) {
      if (request.signal?.aborted) {
        throw new Error("ClaudeSdk: aborted");
      }
      for (const block of event.message?.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          text += block.text;
        } else if (block.type === "tool_use" && block.id && block.name) {
          toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
      }
    }

    return { text, toolUses };
  }
}

/** Concatenates the multi-turn history into a role-prefixed single prompt. */
function renderPrompt(request: ClaudeSdkRequest): string {
  return request.messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");
}

