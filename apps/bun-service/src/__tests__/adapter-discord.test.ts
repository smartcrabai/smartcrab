import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { silenceConsoleError } from "./test-helpers.ts";

import {
  setDiscordClientFactory,
  type DiscordChannelLike,
  type DiscordClientLike,
  type DiscordMessageLike,
} from "../adapters/chat/discord/client.js";
import {
  DEFAULT_DISCORD_CONFIG,
  DISCORD_ADAPTER_ID,
  DiscordChatAdapter,
  parseDiscordConfig,
  resolveDiscordToken,
} from "../adapters/chat/discord/index.js";
import {
  attachMessageListener,
  defaultLlmHandler,
} from "../adapters/chat/discord/listener.js";
import { createSqlitePairingStore } from "../adapters/chat/pairing-store.js";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/index.js";
import { chatRegistry } from "../adapters/chat/registry.js";
import { llmRegistry } from "../adapters/llm/registry.js";
import chatCommands from "../commands/chat.commands.js";

// --- Mocked discord.js client ----------------------------------------------

interface MockClient extends DiscordClientLike {
  loginCalls: string[];
  destroyed: boolean;
  listeners: Record<string, Array<(...args: any[]) => void>>;
  fetched: Map<string, DiscordChannelLike>;
  emit(event: string, ...args: any[]): Promise<void>;
}

function makeMockChannel(): DiscordChannelLike & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: mock(async (content: string) => {
      sent.push(content);
      return { id: `msg-${sent.length}` };
    }),
  };
}

function makeMockClient(channels: Record<string, DiscordChannelLike> = {}): MockClient {
  const fetched = new Map<string, DiscordChannelLike>(Object.entries(channels));
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const client: MockClient = {
    loginCalls: [],
    destroyed: false,
    listeners,
    fetched,
    login: mock(async (token: string) => {
      client.loginCalls.push(token);
      return token;
    }),
    destroy: mock(async () => {
      client.destroyed = true;
    }),
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
      return client;
    },
    once(event, listener) {
      (listeners[event] ??= []).push(listener);
      return client;
    },
    channels: {
      fetch: mock(async (id: string) => fetched.get(id) ?? null),
    },
    async emit(event, ...args) {
      const fns = listeners[event] ?? [];
      for (const fn of fns) {
        await fn(...args);
      }
    },
  };
  return client;
}

// --- Setup / teardown ------------------------------------------------------

const consoleSpy = silenceConsoleError();

beforeEach(() => {
  // Reset the LLM registry so tests don't leak handlers between cases.
  llmRegistry.clear();
  // Re-register the auto-registered Discord adapter so registry list ordering
  // is deterministic across the file.
  chatRegistry.clear();
  chatRegistry.register(new DiscordChatAdapter());
  consoleSpy.setup();
});

afterEach(() => {
  consoleSpy.restore();
  setDiscordClientFactory(null);
});

// --- Config parsing --------------------------------------------------------

describe("DiscordConfig", () => {
  it("parses a full JSON object", () => {
    const cfg = parseDiscordConfig({
      bot_token: "secret",
      dm_policy: "allowlist",
    });
    expect(cfg.bot_token).toBe("secret");
    expect(cfg.dm_policy).toBe("allowlist");
  });

  it("parses an empty config (pre-configuration state)", () => {
    const cfg = parseDiscordConfig({});
    expect(cfg.bot_token).toBeUndefined();
    expect(cfg.dm_policy).toBeUndefined();
  });

  it("rejects non-object input", () => {
    expect(() => parseDiscordConfig("nope")).toThrow(/invalid Discord config/);
  });

  it("rejects non-string bot_token", () => {
    expect(() => parseDiscordConfig({ bot_token: 123 })).toThrow(/bot_token/);
  });

  it("rejects bogus dm_policy values", () => {
    expect(() =>
      parseDiscordConfig({ bot_token: "x", dm_policy: "wat" }),
    ).toThrow(/dm_policy/);
  });

  it("default config omits bot_token and uses the pairing dm policy", () => {
    expect(DEFAULT_DISCORD_CONFIG.bot_token).toBeUndefined();
    expect(DEFAULT_DISCORD_CONFIG.dm_policy).toBe("pairing");
  });
});

describe("resolveDiscordToken", () => {
  it("returns the token when set", () => {
    expect(resolveDiscordToken({ bot_token: "abc123" })).toBe("abc123");
  });

  it("throws when bot_token is empty", () => {
    expect(() => resolveDiscordToken({ bot_token: "" })).toThrow(
      /not configured/,
    );
  });

  it("throws when bot_token is missing", () => {
    expect(() => resolveDiscordToken({})).toThrow(/not configured/);
  });
});

// --- Adapter identity ------------------------------------------------------

describe("DiscordChatAdapter identity", () => {
  it("exposes id, name, and capabilities", () => {
    const a = new DiscordChatAdapter();
    expect(a.id).toBe(DISCORD_ADAPTER_ID);
    expect(a.id).toBe("discord");
    expect(a.name).toBe("Discord");
    expect(a.capabilities.streaming).toBe(false);
    expect(a.capabilities.channels).toEqual(["text"]);
  });

  it("starts not-running by default", () => {
    const a = new DiscordChatAdapter();
    expect(a.isRunning()).toBe(false);
  });

  it("self-registers with chatRegistry on import", () => {
    expect(chatRegistry.get("discord")).toBeDefined();
  });
});

// --- Lifecycle (start/stop/send) -------------------------------------------

describe("DiscordChatAdapter lifecycle", () => {
  it("login is called with the configured token on start, destroy on stop", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "secret-token" } },
    });

    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    expect(client.loginCalls).toEqual(["secret-token"]);

    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
    expect(client.destroyed).toBe(true);
  });

  it("start is idempotent", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "tok" } },
    });
    await adapter.start();
    await adapter.start();
    expect(client.loginCalls.length).toBe(1);
    await adapter.stop();
  });

  it("stop is a no-op when not running", async () => {
    const adapter = new DiscordChatAdapter();
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it("start fails when token is empty", async () => {
    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "" } },
    });
    await expect(adapter.start()).rejects.toThrow(/bot_token/);
    expect(adapter.isRunning()).toBe(false);
  });

  it("start uses a loader-based config source", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: {
        kind: "loader",
        load: async () => ({ bot_token: "loaded-token" }),
      },
    });
    await adapter.start();
    expect(client.loginCalls).toEqual(["loaded-token"]);
    await adapter.stop();
  });

  it("start({ token }) overrides the config-supplied token", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: {
        kind: "literal",
        config: { bot_token: "from-config" },
      },
    });
    await adapter.start({ token: "from-keychain" });
    expect(client.loginCalls).toEqual(["from-keychain"]);
    await adapter.stop();
  });

  it("start({ token }) succeeds even when persisted config has an empty token", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "" } },
    });
    await adapter.start({ token: "keychain-only" });
    expect(client.loginCalls).toEqual(["keychain-only"]);
    await adapter.stop();
  });

  it("start({ token: '  ' }) treats whitespace as missing and falls back to config", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "config-tok" } },
    });
    await adapter.start({ token: "   " });
    expect(client.loginCalls).toEqual(["config-tok"]);
    await adapter.stop();
  });

  it("send posts to the requested channel", async () => {
    const channel = makeMockChannel();
    const client = makeMockClient({ "channel-1": channel });
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "x" } },
    });
    await adapter.start();
    await adapter.send({ channel: "channel-1", body: "hi" });
    expect(channel.sent).toEqual(["hi"]);
    await adapter.stop();
  });

  it("send rejects when adapter is not running", async () => {
    const adapter = new DiscordChatAdapter();
    await expect(adapter.send({ channel: "c", body: "b" })).rejects.toThrow(
      /not running/
    );
  });

  it("send rejects when channel cannot be fetched", async () => {
    const client = makeMockClient(); // no channels
    setDiscordClientFactory(() => client);
    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token: "x" } },
    });
    await adapter.start();
    await expect(adapter.send({ channel: "missing", body: "b" })).rejects.toThrow(
      /not found/
    );
    await adapter.stop();
  });
});

// --- Listener --------------------------------------------------------------

describe("attachMessageListener", () => {
  function makeMessage(overrides: Partial<DiscordMessageLike> = {}): DiscordMessageLike {
    const replyCalls: string[] = [];
    return {
      id: "m1",
      content: "ping",
      channelId: "channel-1",
      // Default to a guild message so existing tests bypass DM pairing.
      // DM-specific tests opt in via `guildId: null`.
      guildId: "guild-1",
      author: { id: "u1", bot: false, username: "alice" },
      reply: mock(async (content: string) => {
        replyCalls.push(content);
        return { id: "reply" };
      }),
      ...overrides,
    } as DiscordMessageLike;
  }

  it("ignores bot-authored messages by default", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "should not run");
    attachMessageListener(client, { handler });

    await client.emit(
      "messageCreate",
      makeMessage({ author: { id: "bot", bot: true } })
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("invokes the handler and replies with its return value", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "pong");
    attachMessageListener(client, { handler });

    const msg = makeMessage();
    await client.emit("messageCreate", msg);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(msg.reply).toHaveBeenCalledWith("pong");
  });

  it("does not reply when handler returns null/void", async () => {
    const client = makeMockClient();
    const handler = mock(async () => null);
    attachMessageListener(client, { handler });

    const msg = makeMessage();
    await client.emit("messageCreate", msg);
    expect(msg.reply).not.toHaveBeenCalled();
  });

  it("falls back to channels.fetch().send when reply is unavailable", async () => {
    const channel = makeMockChannel();
    const client = makeMockClient({ "channel-1": channel });
    const handler = mock(async () => "fallback-reply");
    attachMessageListener(client, { handler });

    const msg = makeMessage({ reply: undefined });
    await client.emit("messageCreate", msg);
    expect(channel.sent).toEqual(["fallback-reply"]);
  });

  it("surfaces handler errors as a reply so a silent /dev/null stderr doesn't hide them", async () => {
    const client = makeMockClient();
    const handler = mock(async () => {
      throw new Error("boom");
    });
    attachMessageListener(client, { handler });

    const spy = spyOn(console, "error").mockImplementation(() => {});
    const msg = makeMessage();
    try {
      // Should not reject.
      await client.emit("messageCreate", msg);
    } finally {
      spy.mockRestore();
    }
    expect(msg.reply).toHaveBeenCalledTimes(1);
    const replyArg = (msg.reply as any).mock.calls[0][0] as string;
    expect(replyArg).toContain("LLM error");
    expect(replyArg).toContain("boom");
  });
});

// --- DM pairing ------------------------------------------------------------

function makeFakePairingStore() {
  // Use the real SqlitePairingStore against an in-memory DB so the listener
  // tests exercise the same code path the SwiftUI client will hit. Avoids
  // drift between a hand-rolled mock and the production store.
  const db = new Database(":memory:");
  runMigrations(db);
  return createSqlitePairingStore(db);
}

describe("attachMessageListener DM pairing", () => {
  function dmMessage(overrides: Partial<DiscordMessageLike> = {}): DiscordMessageLike {
    return {
      id: "dm-1",
      content: "hello",
      channelId: "dm-channel",
      guildId: null,
      author: { id: "user-42", bot: false, username: "bob", tag: "bob#0001" },
      reply: mock(async () => ({ id: "r" })),
      ...overrides,
    } as DiscordMessageLike;
  }

  it("issues a pairing code and skips the handler on first DM", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "should not run");
    const store = makeFakePairingStore();
    attachMessageListener(client, {
      handler,
      dmPolicy: "pairing",
      pairingStore: store,
    });

    const msg = dmMessage();
    await client.emit("messageCreate", msg);

    expect(handler).not.toHaveBeenCalled();
    expect(msg.reply).toHaveBeenCalledTimes(1);
    const replyArg = (msg.reply as any).mock.calls[0][0] as string;
    expect(replyArg).toContain("Pairing code:");
    expect(store.listRequests("discord")).toHaveLength(1);
    expect(store.listRequests("discord")[0]!.senderId).toBe("user-42");
  });

  it("only replies once for repeated DMs from the same sender", async () => {
    const client = makeMockClient();
    const store = makeFakePairingStore();
    attachMessageListener(client, {
      handler: async () => "noop",
      dmPolicy: "pairing",
      pairingStore: store,
    });

    const m1 = dmMessage({ id: "a" });
    const m2 = dmMessage({ id: "b" });
    await client.emit("messageCreate", m1);
    await client.emit("messageCreate", m2);
    expect(m1.reply).toHaveBeenCalledTimes(1);
    expect(m2.reply).not.toHaveBeenCalled();
    expect(store.listRequests("discord")).toHaveLength(1);
  });

  it("forwards DMs to the handler once the sender is approved", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "pong");
    const store = makeFakePairingStore();
    attachMessageListener(client, {
      handler,
      dmPolicy: "pairing",
      pairingStore: store,
    });

    const first = dmMessage();
    await client.emit("messageCreate", first);
    const code = store.listRequests("discord")[0]!.code;
    expect(store.approveCode("discord", code)).not.toBeNull();

    const second = dmMessage({ id: "dm-2" });
    await client.emit("messageCreate", second);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.reply).toHaveBeenCalledWith("pong");
  });

  it("drops DMs when policy is disabled", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "no");
    const store = makeFakePairingStore();
    attachMessageListener(client, {
      handler,
      dmPolicy: "disabled",
      pairingStore: store,
    });

    const msg = dmMessage();
    await client.emit("messageCreate", msg);
    expect(handler).not.toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();
    expect(store.listRequests("discord")).toHaveLength(0);
  });

  it("with policy=allowlist drops unknown senders without replying", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "no");
    const store = makeFakePairingStore();
    attachMessageListener(client, {
      handler,
      dmPolicy: "allowlist",
      pairingStore: store,
    });

    const msg = dmMessage();
    await client.emit("messageCreate", msg);
    expect(handler).not.toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();
    expect(store.listRequests("discord")).toHaveLength(0);
  });

  it("guild messages bypass DM pairing entirely", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "pong");
    const store = makeFakePairingStore();
    attachMessageListener(client, {
      handler,
      dmPolicy: "pairing",
      pairingStore: store,
    });

    const guild: DiscordMessageLike = {
      id: "g1",
      content: "in guild",
      channelId: "ch-x",
      guildId: "g-x",
      author: { id: "u-x", bot: false },
      reply: mock(async () => ({ id: "r" })),
    } as DiscordMessageLike;
    await client.emit("messageCreate", guild);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.listRequests("discord")).toHaveLength(0);
  });

  it("guild messages flow through under every DM policy", async () => {
    const policies = ["pairing", "allowlist", "disabled"] as const;
    for (const policy of policies) {
      const client = makeMockClient();
      const handler = mock(async () => "pong");
      const store = makeFakePairingStore();
      attachMessageListener(client, {
        handler,
        dmPolicy: policy,
        pairingStore: store,
      });

      const guild: DiscordMessageLike = {
        id: `g-${policy}`,
        content: "guild ping",
        channelId: "ch-x",
        guildId: "g-x",
        author: { id: "u-x", bot: false },
        reply: mock(async () => ({ id: "r" })),
      } as DiscordMessageLike;
      await client.emit("messageCreate", guild);
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it("allowlist policy lets approved senders through to the handler", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "yes");
    const store = makeFakePairingStore();
    // Pre-approve the sender directly (mimics SwiftUI approval).
    const { code } = store.upsertRequest({
      adapterId: "discord",
      senderId: "user-42",
    });
    expect(store.approveCode("discord", code)).not.toBeNull();

    attachMessageListener(client, {
      handler,
      dmPolicy: "allowlist",
      pairingStore: store,
    });
    const msg = dmMessage();
    await client.emit("messageCreate", msg);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(msg.reply).toHaveBeenCalledWith("yes");
  });

  it("fails closed when DM policy needs the store but it is missing", async () => {
    const client = makeMockClient();
    const handler = mock(async () => "no");
    attachMessageListener(client, {
      handler,
      dmPolicy: "pairing",
      pairingStore: null,
    });
    const msg = dmMessage();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await client.emit("messageCreate", msg);
    } finally {
      errorSpy.mockRestore();
    }
    expect(handler).not.toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();
  });
});

describe("defaultLlmHandler", () => {
  it("forwards the message content to route() and returns its text", async () => {
    const routeMock = mock(async (_req: { prompt: string }) => ({
      text: "router-reply",
      kind: "claude" as const,
    }));
    const router = await import("../router.ts");
    const spy = spyOn(router, "route").mockImplementation(routeMock as unknown as typeof router.route);
    try {
      const result = await defaultLlmHandler({
        id: "m",
        content: "hello",
        channelId: "ch1",
        author: { id: "u1", bot: false },
      });

      expect(result).toBe("router-reply");
      expect(routeMock).toHaveBeenCalledTimes(1);
      expect((routeMock.mock.calls as any)[0][0]).toMatchObject({ prompt: "hello" });
    } finally {
      spy.mockRestore();
    }
  });

  it("propagates route() failures so the listener's catch logs them", async () => {
    const router = await import("../router.ts");
    const spy = spyOn(router, "route").mockImplementation(async () => {
      throw new Error("router: seher-ts unavailable and no LLM adapter registered");
    });
    try {
      await expect(
        defaultLlmHandler({
          id: "m",
          content: "hi",
          channelId: "c",
          author: { id: "u", bot: false },
        }),
      ).rejects.toThrow(/router/);
    } finally {
      spy.mockRestore();
    }
  });
});

// --- chat.commands ---------------------------------------------------------

describe("chat.commands", () => {
  it("chat.status lists registered adapters", async () => {
    const result = await chatCommands["chat.status"]({});
    expect(result.adapters.some((a) => a.id === "discord")).toBe(true);
  });

  it("chat.status filters by adapter id", async () => {
    const result = await chatCommands["chat.status"]({ adapter: "discord" });
    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0]!.id).toBe("discord");
  });

  it("chat.status throws for unknown adapter", async () => {
    await expect(
      chatCommands["chat.status"]({ adapter: "nope" })
    ).rejects.toThrow(/not registered/);
  });

  it("chat.start and chat.stop drive the registered adapter", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    // Replace the auto-registered adapter with one wired to a literal config.
    chatRegistry.clear();
    chatRegistry.register(
      new DiscordChatAdapter({
        configSource: { kind: "literal", config: { bot_token: "secret" } },
      })
    );

    const started = await chatCommands["chat.start"]({});
    expect(started.running).toBe(true);

    const stopped = await chatCommands["chat.stop"]({});
    expect(stopped.running).toBe(false);
  });

  it("chat.start forwards the token param to the adapter", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    chatRegistry.clear();
    chatRegistry.register(
      new DiscordChatAdapter({
        configSource: { kind: "literal", config: { bot_token: "" } },
      })
    );

    const started = await chatCommands["chat.start"]({ token: "keychain-tok" });
    expect(started.running).toBe(true);
    expect(client.loginCalls).toEqual(["keychain-tok"]);
    await chatCommands["chat.stop"]({});
  });

  it("chat.send requires channel and body", async () => {
    await expect(
      chatCommands["chat.send"]({ channel: "c" } as any)
    ).rejects.toThrow(/channel.*body/);
  });

  it("chat.send forwards to the adapter", async () => {
    const channel = makeMockChannel();
    const client = makeMockClient({ "ch": channel });
    setDiscordClientFactory(() => client);

    chatRegistry.clear();
    chatRegistry.register(
      new DiscordChatAdapter({
        configSource: { kind: "literal", config: { bot_token: "secret" } },
      })
    );

    await chatCommands["chat.start"]({});
    const result = await chatCommands["chat.send"]({ channel: "ch", body: "yo" });
    expect(result.ok).toBe(true);
    expect(channel.sent).toEqual(["yo"]);
    await chatCommands["chat.stop"]({});
  });
});
