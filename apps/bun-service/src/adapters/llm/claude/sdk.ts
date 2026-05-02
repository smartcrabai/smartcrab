/**
 * Thin shim around `@anthropic-ai/claude-agent-sdk`.
 *
 * The shim isolates the (potentially flaky / network-dependent) SDK behind a
 * small surface so the adapter remains testable and the SDK can be swapped or
 * mocked without touching call sites.
 *
 * If the upstream SDK is missing at runtime (e.g. offline CI before
 * `bun install`) we fall back to a deterministic stub that throws when
 * actually invoked but allows imports to succeed.
 */

/**
 * Minimal request shape we hand to the underlying SDK.
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

/**
 * Minimal response shape returned by the SDK shim.
 */
export interface ClaudeSdkResponse {
  readonly text: string;
  readonly toolUses?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
  }>;
  readonly raw?: unknown;
}

/**
 * Minimal interface the adapter relies on. Both the real SDK wrapper and the
 * test mock implement this.
 */
export interface ClaudeSdkClient {
  query(request: ClaudeSdkRequest): Promise<ClaudeSdkResponse>;
}

/**
 * Default SDK client. Lazily resolves the upstream module so a missing
 * dependency only surfaces when `query()` is actually called.
 */
export class DefaultClaudeSdkClient implements ClaudeSdkClient {
  async query(request: ClaudeSdkRequest): Promise<ClaudeSdkResponse> {
    // Dynamic import keeps the dependency optional at module-load time.
    let sdk: unknown;
    try {
      sdk = await import("@anthropic-ai/claude-agent-sdk");
    } catch (cause) {
      throw new Error(
        "@anthropic-ai/claude-agent-sdk is not installed. Run `bun install` " +
          "in apps/bun-service before invoking the Claude adapter.",
        { cause: cause as Error },
      );
    }

    // The SDK exports a `query` async generator. We adapt it to a single
    // request/response by consuming all messages and stitching together text.
    const sdkAny = sdk as {
      query?: (opts: {
        prompt: string;
        options?: Record<string, unknown>;
      }) => AsyncIterable<{
        type?: string;
        message?: {
          content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
        };
      }>;
    };

    if (typeof sdkAny.query !== "function") {
      throw new Error(
        "@anthropic-ai/claude-agent-sdk did not expose a `query` function.",
      );
    }

    const promptText = renderPrompt(request);

    let text = "";
    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

    const messages: unknown[] = [];
    for await (const event of sdkAny.query({
      prompt: promptText,
      options: {
        model: request.model,
        system: request.system,
        tools: request.tools,
        maxTokens: request.maxTokens,
      },
    })) {
      messages.push(event);
      const content = event.message?.content ?? [];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          text += block.text;
        } else if (block.type === "tool_use" && block.id && block.name) {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
    }

    return { text, toolUses, raw: messages };
  }
}

/**
 * Flattens our normalised request into a single prompt string for the SDK's
 * conversational `query()` entry point. Multi-turn replay is preserved by
 * concatenating role-prefixed lines.
 */
function renderPrompt(request: ClaudeSdkRequest): string {
  return request.messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");
}
