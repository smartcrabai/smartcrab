/**
 * Typed Discord adapter configuration.
 *
 * The bot token is stored directly in the SQLite-backed `chat_adapter_config`
 * row (the GUI Settings tab persists it). Plaintext storage matches how
 * Seher provider API keys live in the same database — both are guarded only
 * by the macOS app-sandbox container.
 *
 * `dm_policy` controls how the listener treats DMs (no guild) from senders
 * that are not in the SQLite-backed DM allowlist. See
 * `src/adapters/chat/pairing-store.ts` and OpenClaw's
 * https://github.com/openclaw/openclaw for the underlying model.
 */
export type DiscordDmPolicy = "pairing" | "allowlist" | "disabled";

export const DISCORD_DM_POLICIES: readonly DiscordDmPolicy[] = [
  "pairing",
  "allowlist",
  "disabled",
] as const;

export const DEFAULT_DISCORD_DM_POLICY: DiscordDmPolicy = "pairing";

export interface DiscordConfig {
  /**
   * Bot token used to log in to Discord. Optional because the macOS host
   * supplies it per-call via Keychain (`chat.start({ token })`); only
   * headless/test runs populate this field directly.
   */
  bot_token?: string;
  /**
   * Policy applied to direct messages whose sender is not in the
   * allowlist. Guild messages are unaffected.
   */
  dm_policy?: DiscordDmPolicy;
}

export const DISCORD_ADAPTER_ID = "discord" as const;

export const DEFAULT_DISCORD_CONFIG: DiscordConfig = {
  dm_policy: DEFAULT_DISCORD_DM_POLICY,
};

function isDiscordDmPolicy(value: unknown): value is DiscordDmPolicy {
  return (
    typeof value === "string" &&
    (DISCORD_DM_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * Validate and normalize a raw JSON value into a [`DiscordConfig`].
 * Throws `Error` with an `invalid Discord config` prefix on failure.
 */
export function parseDiscordConfig(value: unknown): DiscordConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid Discord config: expected object");
  }
  const obj = value as Record<string, unknown>;
  const token = obj.bot_token;
  if (token !== undefined && typeof token !== "string") {
    throw new Error("invalid Discord config: bot_token must be a string");
  }
  const dmPolicyRaw = obj.dm_policy;
  if (dmPolicyRaw !== undefined && !isDiscordDmPolicy(dmPolicyRaw)) {
    throw new Error(
      `invalid Discord config: dm_policy must be one of ${DISCORD_DM_POLICIES.join(", ")}`,
    );
  }
  return {
    ...(typeof token === "string" && token ? { bot_token: token } : {}),
    ...(dmPolicyRaw !== undefined ? { dm_policy: dmPolicyRaw } : {}),
  };
}

/**
 * Return the configured token, or throw if it's empty.
 */
export function resolveDiscordToken(config: DiscordConfig): string {
  const token = config.bot_token;
  if (!token) {
    throw new Error("bot_token is not configured");
  }
  return token;
}

export function resolveDmPolicy(config: DiscordConfig): DiscordDmPolicy {
  return config.dm_policy ?? DEFAULT_DISCORD_DM_POLICY;
}
