/**
 * Thin wrapper around `discord.js`'s Client.
 *
 * Loads `discord.js` lazily so:
 *   1. Tests can inject a mock factory without requiring the real package.
 *   2. The CLI binary doesn't pay the cost of loading discord.js until a
 *      Discord adapter is actually started.
 *
 * The shape exposed here is intentionally minimal -- only the methods/events
 * the adapter and listener actually use are typed.
 */
export interface DiscordMessageLike {
  id: string;
  content: string;
  channelId: string;
  /**
   * Guild ID for the message, or `null` / `undefined` when the message
   * was received in a direct message channel. Used by the DM pairing
   * policy to distinguish DM traffic from guild traffic.
   */
  guildId?: string | null;
  author: { id: string; bot: boolean; username?: string; tag?: string };
  reply?: (content: string) => Promise<unknown>;
}

export interface DiscordChannelLike {
  send: (content: string) => Promise<unknown>;
}

export interface DiscordClientLike {
  login: (token: string) => Promise<string>;
  destroy: () => Promise<void> | void;
  on: (event: "messageCreate" | "ready", listener: (...args: any[]) => void) => DiscordClientLike;
  once: (event: "messageCreate" | "ready", listener: (...args: any[]) => void) => DiscordClientLike;
  channels: {
    fetch: (id: string) => Promise<DiscordChannelLike | null>;
  };
}

export interface DiscordClientFactoryOptions {
  intents: number[];
}

export type DiscordClientFactory = (options: DiscordClientFactoryOptions) => DiscordClientLike;

let cachedFactory: DiscordClientFactory | null = null;

/**
 * Override the factory used to construct discord.js clients. Intended for
 * tests; production code calls {@link createDiscordClient} which lazy-loads
 * the real `discord.js` module.
 */
export function setDiscordClientFactory(factory: DiscordClientFactory | null): void {
  cachedFactory = factory;
}

/**
 * Construct a discord.js client. Uses the test override if one has been set
 * via {@link setDiscordClientFactory}; otherwise dynamically imports
 * `discord.js`. We import lazily so this module never crashes at load time
 * when the package is unavailable (e.g. during isolated unit tests).
 */
export async function createDiscordClient(
  options: DiscordClientFactoryOptions
): Promise<DiscordClientLike> {
  if (cachedFactory) {
    return cachedFactory(options);
  }
  // Dynamic import lets test environments mock discord.js without it being
  // installed and keeps cold-start cost out of the JSON-RPC server.
  const mod: any = await import("discord.js");
  const Client = mod.Client;
  const GatewayIntentBits = mod.GatewayIntentBits ?? {};
  const Partials = mod.Partials ?? {};
  const intents = options.intents.length > 0
    ? options.intents
    : [
        GatewayIntentBits.Guilds ?? 1,
        GatewayIntentBits.GuildMessages ?? 512,
        GatewayIntentBits.MessageContent ?? 32768,
        GatewayIntentBits.DirectMessages ?? 4096,
      ];
  // Required to receive DMs from uncached channels (first-time pairings).
  // Numeric fallbacks keep stubbed test factories working without `Partials`.
  // discord.js v14: Channel=1, Message=3 (GuildMember=2 lives between them).
  const partials = [
    Partials.Channel ?? 1,
    Partials.Message ?? 3,
  ];
  return new Client({ intents, partials }) as DiscordClientLike;
}
