import { llmRegistry } from "../../llm/registry.js";
import type { DiscordClientLike, DiscordMessageLike } from "./client.js";

/**
 * Callback signature for incoming Discord messages. Returning a string causes
 * the listener's default "post a reply" behavior to send that string back to
 * the originating channel; returning `void`/`null` leaves the message
 * unanswered (the callback handled it directly).
 */
export type DiscordMessageHandler = (
  message: DiscordMessageLike
) => Promise<string | void | null> | string | void | null;

export interface AttachListenerOptions {
  /** Custom handler. Defaults to LLM-routing via `llmRegistry`. */
  handler?: DiscordMessageHandler;
  /**
   * If true, messages authored by bots (including the adapter itself) are
   * skipped. Defaults to `true` to avoid feedback loops.
   */
  ignoreBots?: boolean;
}

/**
 * Default routing: forward the message body to the registered default LLM
 * adapter and return its response text. Returns `null` when no LLM is
 * registered so the listener stays silent rather than echoing.
 */
export const defaultLlmHandler: DiscordMessageHandler = async (message) => {
  const llm = llmRegistry.default();
  if (!llm) {
    return null;
  }
  const response = await llm.generate({
    prompt: message.content,
    context: {
      source: "discord",
      channelId: message.channelId,
      authorId: message.author.id,
    },
  });
  return response.text;
};

/**
 * Wire `messageCreate` on the supplied client and return a detach function.
 *
 * Errors from the handler are caught and re-thrown only if the caller
 * provides an `onError` callback via `globalThis` -- in normal operation we
 * log them to stderr so a single bad message can't kill the whole adapter.
 */
export function attachMessageListener(
  client: DiscordClientLike,
  options: AttachListenerOptions = {}
): () => void {
  const handler = options.handler ?? defaultLlmHandler;
  const ignoreBots = options.ignoreBots ?? true;

  const onMessage = async (message: DiscordMessageLike): Promise<void> => {
    try {
      if (ignoreBots && message.author?.bot) return;
      const result = await handler(message);
      if (typeof result === "string" && result.length > 0) {
        if (typeof message.reply === "function") {
          await message.reply(result);
        } else {
          // Fall back to channel.send when reply isn't available (e.g. mock).
          const channel = await client.channels.fetch(message.channelId);
          if (channel) {
            await channel.send(result);
          }
        }
      }
    } catch (err) {
      // Log via stderr -- the JSON-RPC contract requires stdout stays clean.
      // eslint-disable-next-line no-console
      console.error("[discord-listener] handler error:", err);
    }
  };

  client.on("messageCreate", onMessage);

  return () => {
    // discord.js exposes `off`; we don't strictly need to detach because
    // `client.destroy()` clears all listeners, but keep the contract clean.
    const off = (client as unknown as { off?: (event: string, fn: any) => void }).off;
    if (typeof off === "function") {
      off.call(client, "messageCreate", onMessage);
    }
  };
}
