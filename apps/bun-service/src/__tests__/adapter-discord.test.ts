import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

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

const ORIGINAL_TOKEN = process.env.DISCORD_BOT_TOKEN;

beforeEach(() => {
  // Reset the LLM registry so tests don't leak handlers between cases.
  llmRegistry.clear();
  // Re-register the auto-registered Discord adapter so registry list ordering
  // is deterministic across the file.
  chatRegistry.clear();
  chatRegistry.register(new DiscordChatAdapter());
});

afterEach(() => {
  setDiscordClientFactory(null);
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.DISCORD_BOT_TOKEN;
  } else {
    process.env.DISCORD_BOT_TOKEN = ORIGINAL_TOKEN;
  }
});

// --- Config parsing --------------------------------------------------------

describe("DiscordConfig", () => {
  it("parses a full JSON object", () => {
    const cfg = parseDiscordConfig({
      bot_token_env: "MY_TOKEN",
      notification_channel_id: "789",
    });
    expect(cfg.bot_token_env).toBe("MY_TOKEN");
    expect(cfg.notification_channel_id).toBe("789");
  });

  it("parses without the optional channel id", () => {
    const cfg = parseDiscordConfig({ bot_token_env: "X" });
    expect(cfg.bot_token_env).toBe("X");
    expect(cfg.notification_channel_id).toBeUndefined();
  });

  it("rejects non-object input", () => {
    expect(() => parseDiscordConfig("nope")).toThrow(/invalid Discord config/);
  });

  it("rejects missing bot_token_env", () => {
    expect(() => parseDiscordConfig({})).toThrow(/bot_token_env/);
  });

  it("default config has empty bot_token_env", () => {
    expect(DEFAULT_DISCORD_CONFIG.bot_token_env).toBe("");
    expect(DEFAULT_DISCORD_CONFIG.notification_channel_id).toBeUndefined();
  });
});

describe("resolveDiscordToken", () => {
  it("returns the env var value when set", () => {
    const token = resolveDiscordToken(
      { bot_token_env: "MY_TOKEN" },
      { MY_TOKEN: "abc123" }
    );
    expect(token).toBe("abc123");
  });

  it("throws when bot_token_env is empty", () => {
    expect(() => resolveDiscordToken({ bot_token_env: "" }, {})).toThrow(
      /not configured/
    );
  });

  it("throws when env var is missing", () => {
    expect(() => resolveDiscordToken({ bot_token_env: "X" }, {})).toThrow(
      /'X' is not set/
    );
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
  it("login is called with the resolved token on start, destroy on stop", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token_env: "MY_TOKEN" } },
      env: { MY_TOKEN: "secret-token" },
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
      configSource: { kind: "literal", config: { bot_token_env: "T" } },
      env: { T: "tok" },
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

  it("start fails when env var is missing", async () => {
    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token_env: "MISSING_VAR" } },
      env: {},
    });
    await expect(adapter.start()).rejects.toThrow(/MISSING_VAR/);
    expect(adapter.isRunning()).toBe(false);
  });

  it("start uses a loader-based config source", async () => {
    const client = makeMockClient();
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: {
        kind: "loader",
        load: async () => ({ bot_token_env: "FROM_DB" }),
      },
      env: { FROM_DB: "loaded-token" },
    });
    await adapter.start();
    expect(client.loginCalls).toEqual(["loaded-token"]);
    await adapter.stop();
  });

  it("send posts to the requested channel", async () => {
    const channel = makeMockChannel();
    const client = makeMockClient({ "channel-1": channel });
    setDiscordClientFactory(() => client);

    const adapter = new DiscordChatAdapter({
      configSource: { kind: "literal", config: { bot_token_env: "T" } },
      env: { T: "x" },
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
      configSource: { kind: "literal", config: { bot_token_env: "T" } },
      env: { T: "x" },
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

  it("swallows handler errors so a single bad message can't crash the bot", async () => {
    const client = makeMockClient();
    const handler = mock(async () => {
      throw new Error("boom");
    });
    attachMessageListener(client, { handler });

    // Should not reject.
    await client.emit("messageCreate", makeMessage());
  });
});

describe("defaultLlmHandler", () => {
  it("returns null when no LLM is registered", async () => {
    const result = await defaultLlmHandler({
      id: "m",
      content: "hi",
      channelId: "c",
      author: { id: "u", bot: false },
    });
    expect(result).toBeNull();
  });

  it("forwards prompt + context to the default LLM and returns its text", async () => {
    const generate = mock(async () => ({ text: "llm-reply" }));
    llmRegistry.register({ id: "fake", generate }, { default: true });

    const result = await defaultLlmHandler({
      id: "m",
      content: "hello",
      channelId: "ch1",
      author: { id: "u1", bot: false },
    });

    expect(result).toBe("llm-reply");
    expect(generate).toHaveBeenCalledTimes(1);
    const call = (generate.mock.calls as any)[0][0];
    expect(call.prompt).toBe("hello");
    expect(call.context).toMatchObject({
      source: "discord",
      channelId: "ch1",
      authorId: "u1",
    });
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

    // Replace the auto-registered adapter with one wired to mock env.
    chatRegistry.clear();
    chatRegistry.register(
      new DiscordChatAdapter({
        configSource: { kind: "literal", config: { bot_token_env: "T" } },
        env: { T: "secret" },
      })
    );

    const started = await chatCommands["chat.start"]({});
    expect(started.running).toBe(true);

    const stopped = await chatCommands["chat.stop"]({});
    expect(stopped.running).toBe(false);
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
        configSource: { kind: "literal", config: { bot_token_env: "T" } },
        env: { T: "secret" },
      })
    );

    await chatCommands["chat.start"]({});
    const result = await chatCommands["chat.send"]({ channel: "ch", body: "yo" });
    expect(result.ok).toBe(true);
    expect(channel.sent).toEqual(["yo"]);
    await chatCommands["chat.stop"]({});
  });
});
