import {
  type ChatAdapter,
  type ChatCapabilities,
  type ChatSendArgs,
  chatRegistry,
} from "../registry.js";
import {
  createDiscordClient,
  type DiscordClientLike,
} from "./client.js";
import {
  attachMessageListener,
  type AttachListenerOptions,
  type DiscordMessageHandler,
} from "./listener.js";
import {
  DEFAULT_DISCORD_CONFIG,
  DISCORD_ADAPTER_ID,
  type DiscordConfig,
  parseDiscordConfig,
  resolveDiscordToken,
} from "./types.js";

/**
 * Source for the Discord configuration. Production wires this to the
 * `chat_adapter_config` SQLite row; tests pass a literal value.
 */
export type DiscordConfigSource =
  | { kind: "literal"; config: DiscordConfig }
  | { kind: "loader"; load: () => Promise<unknown> };

export interface DiscordChatAdapterOptions {
  /** Where the adapter pulls its configuration from. */
  configSource?: DiscordConfigSource;
  /** Override the env source for token resolution (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Override the message handler / ignoreBots flag. */
  listenerOptions?: AttachListenerOptions;
}

export const DISCORD_CAPABILITIES: ChatCapabilities = {
  streaming: false,
  channels: ["text"],
};

/**
 * Discord chat adapter implementation.
 *
 * TS port of `crates/smartcrab-app/src-tauri/src/adapters/chat/discord.rs`.
 * Owns a single discord.js Client; `start()` logs in, `stop()` destroys.
 * Self-registers with the global `chatRegistry` on construction so the
 * dispatcher can find it without an explicit wiring step.
 */
export class DiscordChatAdapter implements ChatAdapter {
  readonly id = DISCORD_ADAPTER_ID;
  readonly name = "Discord";
  readonly capabilities = DISCORD_CAPABILITIES;

  private client: DiscordClientLike | null = null;
  private detachListener: (() => void) | null = null;
  private running = false;

  constructor(private readonly options: DiscordChatAdapterOptions = {}) {}

  async start(): Promise<void> {
    if (this.running) return;

    const config = await this.loadConfig();
    const token = resolveDiscordToken(config, this.options.env);

    const client = await createDiscordClient({ intents: [] });
    this.detachListener = attachMessageListener(client, this.options.listenerOptions);
    await client.login(token);

    this.client = client;
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.detachListener) {
      try { this.detachListener(); } catch { /* ignore */ }
      this.detachListener = null;
    }
    const client = this.client;
    this.client = null;
    if (client) {
      await client.destroy();
    }
  }

  async send({ channel, body }: ChatSendArgs): Promise<void> {
    if (!this.client) {
      throw new Error("discord adapter is not running");
    }
    if (!channel) {
      throw new Error("discord.send: channel is required");
    }
    const target = await this.client.channels.fetch(channel);
    if (!target) {
      throw new Error(`discord.send: channel '${channel}' not found`);
    }
    await target.send(body);
  }

  isRunning(): boolean {
    return this.running;
  }

  private async loadConfig(): Promise<DiscordConfig> {
    if (this.options.configSource) {
      const source = this.options.configSource;
      if (source.kind === "literal") return source.config;
      const raw = await source.load();
      return parseDiscordConfig(raw);
    }
    // Module-level loader (set by server.ts at boot to read the persisted
    // config out of SQLite via settings.adapter-load). Falls back to the
    // env-only default when no loader is wired (tests, dev runs).
    const fromDefault = await defaultLoader?.();
    if (fromDefault) return parseDiscordConfig(fromDefault);
    return { bot_token_env: "DISCORD_BOT_TOKEN" };
  }
}

let defaultLoader: (() => Promise<unknown> | unknown) | null = null;

/** Wire the module-level default config loader. server.ts uses this to pull
 *  the saved Discord config out of SQLite (settings.adapter-load row) so the
 *  GUI's Settings tab actually drives the adapter. */
export function setDiscordConfigLoader(
  loader: (() => Promise<unknown> | unknown) | null,
): void {
  defaultLoader = loader;
}

// Self-register so dispatcher's eager glob auto-imports wire this up.
chatRegistry.register(new DiscordChatAdapter());

export {
  DEFAULT_DISCORD_CONFIG,
  DISCORD_ADAPTER_ID,
  parseDiscordConfig,
  resolveDiscordToken,
} from "./types.js";
export type { DiscordConfig } from "./types.js";
export type { DiscordMessageHandler };
