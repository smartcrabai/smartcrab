/**
 * Typed Discord adapter configuration.
 *
 * Ported from `crates/smartcrab-app/src-tauri/src/adapters/chat/discord.rs`
 * (`DiscordConfig`). Token values themselves are never persisted -- only the
 * env var name. This mirrors the Rust adapter so the SQLite row format stays
 * identical across the Rust → Bun migration.
 */
export interface DiscordConfig {
  /** Name of the environment variable that holds the bot token. */
  bot_token_env: string;
  /** Optional channel ID to post unsolicited notifications to. */
  notification_channel_id?: string;
}

export const DISCORD_ADAPTER_ID = "discord" as const;

export const DEFAULT_DISCORD_CONFIG: DiscordConfig = {
  bot_token_env: "",
};

/**
 * Validate and normalize a raw JSON value into a [`DiscordConfig`].
 * Throws `Error` with an `invalid Discord config` prefix on failure (matches
 * the Rust adapter's `AppError::InvalidInput` shape).
 */
export function parseDiscordConfig(value: unknown): DiscordConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid Discord config: expected object");
  }
  const obj = value as Record<string, unknown>;
  const tokenEnv = obj.bot_token_env;
  if (typeof tokenEnv !== "string") {
    throw new Error("invalid Discord config: bot_token_env must be a string");
  }
  const channelId = obj.notification_channel_id;
  if (channelId !== undefined && typeof channelId !== "string") {
    throw new Error(
      "invalid Discord config: notification_channel_id must be a string"
    );
  }
  return {
    bot_token_env: tokenEnv,
    ...(channelId !== undefined ? { notification_channel_id: channelId } : {}),
  };
}

/**
 * Resolve the configured token from process.env. Throws when the env var is
 * missing or `bot_token_env` is empty -- matches the Rust adapter behavior.
 */
export function resolveDiscordToken(
  config: DiscordConfig,
  env: Record<string, string | undefined> = process.env
): string {
  if (!config.bot_token_env) {
    throw new Error("bot_token_env is not configured");
  }
  const value = env[config.bot_token_env];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `environment variable '${config.bot_token_env}' is not set`
    );
  }
  return value;
}
