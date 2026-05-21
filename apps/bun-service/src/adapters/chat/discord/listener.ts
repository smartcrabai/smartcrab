import { llmRegistry } from "../../llm/registry.js";
import { getPairingStore, type PairingStore } from "../pairing-store.js";
import type { DiscordClientLike, DiscordMessageLike } from "./client.js";
import { DISCORD_ADAPTER_ID, type DiscordDmPolicy } from "./types.js";

const debugEnabled = (): boolean => Boolean(process.env.SMARTCRAB_DISCORD_DEBUG);

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
  /**
   * Policy applied to direct messages from unknown senders. Defaults to
   * `"pairing"` (issue a pairing code, hold the message).
   */
  dmPolicy?: DiscordDmPolicy;
  /**
   * Override for the SQLite-backed pairing store. Defaults to the
   * module-level handle set by `server.ts` at boot. Tests inject a fake.
   */
  pairingStore?: PairingStore | null;
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
  const response = await llm.complete({
    prompt: message.content,
    options: {
      context: {
        source: "discord",
        channelId: message.channelId,
        authorId: message.author.id,
      },
    },
  });
  return response.content;
};

function isDirectMessage(message: DiscordMessageLike): boolean {
  // discord.js sets guildId to null for DMs. Some mocks omit the field
  // entirely; treat undefined the same as null for safety.
  return message.guildId === null || message.guildId === undefined;
}

function buildPairingReply(params: { code: string; senderId: string }): string {
  return [
    "SmartCrab: this Discord bot is not yet paired with you.",
    "",
    `Your Discord user id: ${params.senderId}`,
    "Pairing code:",
    "```",
    params.code,
    "```",
    "",
    "Ask the bot owner to open SmartCrab → Settings → Adapters → Discord",
    "and approve this pairing code.",
  ].join("\n");
}

async function sendReply(
  client: DiscordClientLike,
  message: DiscordMessageLike,
  body: string,
): Promise<void> {
  if (typeof message.reply === "function") {
    await message.reply(body);
    return;
  }
  const channel = await client.channels.fetch(message.channelId);
  if (channel) {
    await channel.send(body);
  }
}

/**
 * Wire `messageCreate` on the supplied client and return a detach function.
 *
 * DM behaviour follows `dmPolicy`:
 *   - `allowlist`— DMs only flow through when the sender is approved
 *   - `pairing`  — unapproved senders get a pairing code DM, no LLM call
 *   - `disabled` — DMs are dropped silently
 *
 * Guild messages always flow through to the handler regardless of policy.
 */
export function attachMessageListener(
  client: DiscordClientLike,
  options: AttachListenerOptions = {}
): () => void {
  const handler = options.handler ?? defaultLlmHandler;
  const ignoreBots = options.ignoreBots ?? true;
  const dmPolicy: DiscordDmPolicy = options.dmPolicy ?? "pairing";
  const resolvePairingStore = (): PairingStore | null =>
    options.pairingStore !== undefined ? options.pairingStore : getPairingStore();

  const onMessage = async (message: DiscordMessageLike): Promise<void> => {
    try {
      const dm = isDirectMessage(message);
      // DMs are rare enough to log unconditionally; guild messages would spam.
      if (dm || debugEnabled()) {
        // eslint-disable-next-line no-console
        console.error(
          `[discord-listener] messageCreate dm=${dm} author=${message.author?.id ?? "?"} bot=${message.author?.bot ?? "?"} content_len=${message.content?.length ?? 0}`,
        );
      }
      if (ignoreBots && message.author?.bot) return;

      if (dm) {
        const allowed = await applyDmPolicy({
          client,
          message,
          dmPolicy,
          store: resolvePairingStore(),
        });
        if (!allowed) return;
      }

      const result = await handler(message);
      if (typeof result === "string" && result.length > 0) {
        await sendReply(client, message, result);
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

async function applyDmPolicy(params: {
  client: DiscordClientLike;
  message: DiscordMessageLike;
  dmPolicy: DiscordDmPolicy;
  store: PairingStore | null;
}): Promise<boolean> {
  const { client, message, dmPolicy, store } = params;
  const senderId = message.author?.id ?? "";

  if (dmPolicy === "disabled") {
    return false;
  }
  if (!store) {
    // Without a store we cannot enforce allowlist/pairing safely.
    // Fail closed so an un-bootstrapped service does not silently
    // forward unknown DMs to the LLM.
    // eslint-disable-next-line no-console
    console.error(
      "[discord-listener] dm received but pairing store is unavailable; dropping",
    );
    return false;
  }
  if (!senderId) return false;
  if (store.isAllowed(DISCORD_ADAPTER_ID, senderId)) {
    if (debugEnabled()) {
      // eslint-disable-next-line no-console
      console.error(`[discord-listener] dm allowed (approved sender ${senderId})`);
    }
    return true;
  }

  if (dmPolicy === "allowlist") {
    return false;
  }

  // pairing: issue a code (idempotent within the TTL) and reply once.
  const { code, created } = store.upsertRequest({
    adapterId: DISCORD_ADAPTER_ID,
    senderId,
    meta: {
      name: message.author?.username,
      tag: message.author?.tag,
    },
  });
  // eslint-disable-next-line no-console
  console.error(
    `[discord-listener] pairing upsert sender=${senderId} created=${created} code=${code || "<capped>"}`,
  );
  if (created && code) {
    try {
      await sendReply(client, message, buildPairingReply({ code, senderId }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[discord-listener] failed to send pairing reply:", err);
    }
  }
  return false;
}
