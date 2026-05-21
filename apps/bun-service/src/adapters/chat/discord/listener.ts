import { route } from "../../../router.js";
import { getPairingStore, type PairingStore } from "../pairing-store.js";
import type { DiscordClientLike, DiscordMessageLike } from "./client.js";
import { DISCORD_ADAPTER_ID, type DiscordDmPolicy } from "./types.js";

const LOG_PREFIX = "[discord-listener]";
const debugEnabled = (): boolean => Boolean(process.env.SMARTCRAB_DISCORD_DEBUG);

function logError(...args: unknown[]): void {
  console.error(LOG_PREFIX, ...args);
}

/** sendReply wrapper that logs on failure instead of throwing. */
async function safeSendReply(
  client: DiscordClientLike,
  message: DiscordMessageLike,
  body: string,
  context: string,
): Promise<void> {
  try {
    await sendReply(client, message, body);
  } catch (err) {
    logError(`${context} failed:`, err);
  }
}

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
  /** Custom handler. Defaults to LLM-routing via the seher-ts `route()`. */
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
 * Default routing: send the DM body through the same seher-ts router the
 * in-app chat bubble uses. Going through `route()` (vs. talking to
 * `llmRegistry.default()` directly) means Discord inherits the user's
 * configured agent resolution -- Claude Agent SDK / Copilot / pi-coding-agent
 * -- instead of unconditionally spawning the Claude Code CLI which fails
 * silently when run inside the macOS app sandbox.
 */
export const defaultLlmHandler: DiscordMessageHandler = async (message) => {
  const result = await route({ prompt: message.content });
  return result.text;
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
    const dm = isDirectMessage(message);
    // DMs are rare enough to log unconditionally; guild messages would spam.
    if (dm || debugEnabled()) {
      logError(
        `messageCreate dm=${dm} author=${message.author?.id ?? "?"} bot=${message.author?.bot ?? "?"} content_len=${message.content?.length ?? 0}`,
      );
    }
    if (ignoreBots && message.author?.bot) return;

    if (dm) {
      let allowed = false;
      try {
        allowed = await applyDmPolicy({
          client,
          message,
          dmPolicy,
          store: resolvePairingStore(),
        });
      } catch (err) {
        logError("dm policy error:", err);
        return;
      }
      if (!allowed) return;
    }

    // GUI-launched SmartCrab pipes bun-service stderr to /dev/null, so a
    // silent handler failure looks identical to a working bot from the
    // user's Discord client. Surface failures as a DM reply.
    let result: string | void | null;
    try {
      result = await handler(message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError("handler error:", err);
      await safeSendReply(client, message, `LLM error: ${msg}`, "error reply");
      return;
    }
    if (typeof result === "string" && result.length > 0) {
      await safeSendReply(client, message, result, "reply");
    } else if (dm) {
      await safeSendReply(
        client,
        message,
        "(SmartCrab: LLM returned no content. Check seher-config.yaml or the LLM adapter status.)",
        "empty-reply notice",
      );
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
    // Without a store we cannot enforce allowlist/pairing safely. Fail closed
    // so an un-bootstrapped service does not silently forward unknown DMs to
    // the LLM.
    logError("dm received but pairing store is unavailable; dropping");
    return false;
  }
  if (!senderId) return false;
  if (store.isAllowed(DISCORD_ADAPTER_ID, senderId)) {
    if (debugEnabled()) {
      logError(`dm allowed (approved sender ${senderId})`);
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
  logError(
    `pairing upsert sender=${senderId} created=${created} code=${code || "<capped>"}`,
  );
  if (created && code) {
    await safeSendReply(client, message, buildPairingReply({ code, senderId }), "pairing reply");
  }
  return false;
}
