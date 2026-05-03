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

    let text = "";
    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const event of sdk.query({
      prompt: renderPrompt(request),
      options: {
        model: request.model,
        system: request.system,
        tools: request.tools,
        maxTokens: request.maxTokens,
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
