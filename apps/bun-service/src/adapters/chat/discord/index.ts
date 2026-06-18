import {
  type ChatAdapter,
  type ChatCapabilities,
  type ChatSendArgs,
  type ChatStartOptions,
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
  DISCORD_ADAPTER_ID,
  type DiscordConfig,
  parseDiscordConfig,
  resolveDiscordToken,
  resolveDmPolicy,
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
  private startInFlight: Promise<void> | null = null;

  constructor(private readonly options: DiscordChatAdapterOptions = {}) {}

  /**
   * Concurrent `start()` calls coalesce onto one login. The RPC server
   * dispatches requests concurrently, and the GUI has two independent
   * `chat.start` call sites (launch autostart and the Settings toggle), so
   * without this guard two logins could race and leak a client.
   */
  async start(options: ChatStartOptions = {}): Promise<void> {
    if (this.running) return;
    if (this.startInFlight) return this.startInFlight;
    this.startInFlight = this.doStart(options).finally(() => {
      this.startInFlight = null;
    });
    return this.startInFlight;
  }

  private async doStart(options: ChatStartOptions): Promise<void> {
    const config = await this.loadConfig();
    // Per-call token wins (the macOS host sources it from Keychain on each
    // chat.start). Falls back to the persisted config for headless runs.
    const override = options.token?.trim();
    const effective: DiscordConfig = override
      ? { ...config, bot_token: override }
      : config;
    const token = resolveDiscordToken(effective);
    const dmPolicy = resolveDmPolicy(effective);

    const client = await createDiscordClient({ intents: [] });
    const listenerOptions = {
      ...(this.options.listenerOptions ?? {}),
      // Explicit options win, but if the caller didn't pin dmPolicy we
      // take it from the persisted config so the Settings tab drives it.
      dmPolicy: this.options.listenerOptions?.dmPolicy ?? dmPolicy,
      // Explicit options win; fall back to the module-level getter wired by
      // server.ts so the Settings tab's chatContextLimit is respected.
      getContextLimit:
        this.options.listenerOptions?.getContextLimit ?? contextLimitGetter ?? undefined,
    };
    this.detachListener = attachMessageListener(client, listenerOptions);
    await client.login(token);

    this.client = client;
    this.running = true;
  }

  async stop(): Promise<void> {
    // Let an in-flight start finish first so stop() actually tears it down
    // instead of no-opping on `running === false` and leaving the adapter up.
    if (this.startInFlight) {
      try {
        await this.startInFlight;
      } catch {
        // Start failed; there is nothing to tear down.
      }
    }
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
    const fromDefault = await defaultLoader?.();
    return fromDefault ? parseDiscordConfig(fromDefault) : {};
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

let contextLimitGetter: (() => number) | null = null;

/** Wire the module-level context limit getter. server.ts uses this to read
 *  chatContextLimit from the seher_config row so the Settings tab drives it. */
export function setDiscordContextLimitGetter(getter: (() => number) | null): void {
  contextLimitGetter = getter;
}

// Self-register so dispatcher's eager glob auto-imports wire this up.
chatRegistry.register(new DiscordChatAdapter());

export {
  DEFAULT_DISCORD_CONFIG,
  DEFAULT_DISCORD_DM_POLICY,
  DISCORD_ADAPTER_ID,
  DISCORD_DM_POLICIES,
  parseDiscordConfig,
  resolveDiscordToken,
  resolveDmPolicy,
} from "./types.js";
export type { DiscordConfig, DiscordDmPolicy } from "./types.js";
export type { DiscordMessageHandler };
