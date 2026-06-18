import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import handlers, {
  configureChatBubbleCommands,
  setMemoryHookEnabled,
} from "../commands/chat-bubble.commands.js";
import {
  buildPromptWithHistory,
  type HistoryMessage,
} from "../adapters/chat/format-history.js";

// Disable the memory hook so tests don't depend on the shared memory store.
beforeEach(() => {
  setMemoryHookEnabled(false);
  configureChatBubbleCommands({}); // reset to a fresh InMemoryBubbleStore with default limit
});

// ---------------------------------------------------------------------------
// buildPromptWithHistory unit tests
// ---------------------------------------------------------------------------

describe("buildPromptWithHistory", () => {
  it("returns only the current message when history is empty", () => {
    // Given: no history (callers pass [] when limit=0 via store.listRecent)
    // When: building the prompt
    // Then: only the current message is returned (single-turn behavior)
    const result = buildPromptWithHistory([], "current");
    expect(result).toBe("current");
  });

  it("prepends history messages before the current message", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "user said A" },
      { role: "assistant", content: "bot replied B" },
    ];
    const result = buildPromptWithHistory(history, "now C");
    // All three turns are present
    expect(result).toContain("user said A");
    expect(result).toContain("bot replied B");
    expect(result).toContain("now C");
    // History comes before the current message
    expect(result.indexOf("user said A")).toBeLessThan(result.indexOf("now C"));
    expect(result.indexOf("bot replied B")).toBeLessThan(result.indexOf("now C"));
  });

  it("labels user turns as 'User:' and assistant turns as 'Assistant:'", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello back" },
    ];
    const result = buildPromptWithHistory(history, "how are you");
    expect(result).toContain("User: hi there");
    expect(result).toContain("Assistant: hello back");
    expect(result).toContain("User: how are you");
  });

  it("oldest messages are dropped when caller pre-filters to the limit", () => {
    const allHistory: HistoryMessage[] = [
      { role: "user", content: "msg-1" },
      { role: "user", content: "msg-2" },
      { role: "user", content: "msg-3" },
    ];
    // Caller pre-filters to last 2 (as store.listRecent / Discord fetch do)
    const result = buildPromptWithHistory(allHistory.slice(-2), "msg-4");
    // The oldest message is dropped
    expect(result).not.toContain("msg-1");
    // The two most recent remain
    expect(result).toContain("msg-2");
    expect(result).toContain("msg-3");
    expect(result).toContain("msg-4");
  });

  it("handles system role messages with a 'System:' label", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "you are a helpful assistant" },
    ];
    const result = buildPromptWithHistory(history, "hello");
    expect(result).toContain("System: you are a helpful assistant");
  });
});

// ---------------------------------------------------------------------------
// chat.bubble-send — existing behavior (no history)
// ---------------------------------------------------------------------------

describe("chat.bubble-send without context history (limit=0)", () => {
  it("sends only the current message content to route when limit is 0", async () => {
    // Given: limit=0 (history disabled)
    configureChatBubbleCommands({ getContextLimit: () => 0 });

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "response", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      // When: sending a message
      await handlers["chat.bubble-send"]({ content: "hello world" });

      // Then: route receives only the current content
      expect(routeMock).toHaveBeenCalledTimes(1);
      const call = (routeMock.mock.calls as any)[0][0];
      expect(call.prompt).toBe("hello world");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns an assistant bubble even when limit=0", async () => {
    configureChatBubbleCommands({ getContextLimit: () => 0 });

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "hi back", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      const bubble = await handlers["chat.bubble-send"]({ content: "ping" });
      expect(bubble.role).toBe("assistant");
      expect(bubble.content).toBe("hi back");
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// chat.bubble-send — context history behavior
// ---------------------------------------------------------------------------

describe("chat.bubble-send with context history", () => {
  it("includes previous turns in the route prompt when chatContextLimit > 0", async () => {
    // Given: limit=2, two prior send/reply cycles
    configureChatBubbleCommands({ getContextLimit: () => 2 });

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "assistant-reply", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      // When: building up 2 previous turns then sending a third message
      await handlers["chat.bubble-send"]({ content: "first message" });
      await handlers["chat.bubble-send"]({ content: "second message" });
      routeMock.mockClear();

      await handlers["chat.bubble-send"]({ content: "third message" });

      // Then: route receives a prompt that includes history (not bare content)
      expect(routeMock).toHaveBeenCalledTimes(1);
      const call = (routeMock.mock.calls as any)[0][0];
      expect(call.prompt).toContain("third message");
      // The bare content alone is not the prompt when history is active
      expect(call.prompt).not.toBe("third message");
    } finally {
      spy.mockRestore();
    }
  });

  it("prompt contains User/Assistant labels for history turns", async () => {
    configureChatBubbleCommands({ getContextLimit: () => 5 });

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "bot-response", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      // Build a prior user+assistant turn
      await handlers["chat.bubble-send"]({ content: "user message 1" });
      routeMock.mockClear();

      // When: sending the second message
      await handlers["chat.bubble-send"]({ content: "user message 2" });

      // Then: prompt contains labeled turns
      const call = (routeMock.mock.calls as any)[0][0];
      expect(call.prompt).toContain("User:");
      expect(call.prompt).toContain("user message 1");
      expect(call.prompt).toContain("User: user message 2");
    } finally {
      spy.mockRestore();
    }
  });

  it("limits the included history to the configured count", async () => {
    // Given: limit=1 — only the most recent prior turn should be included
    configureChatBubbleCommands({ getContextLimit: () => 1 });

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "reply", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      await handlers["chat.bubble-send"]({ content: "msg-1" });
      await handlers["chat.bubble-send"]({ content: "msg-2" });
      routeMock.mockClear();

      // When: third send with limit=1
      await handlers["chat.bubble-send"]({ content: "msg-3" });

      // Then: the most recent prior turn IS included and the oldest is dropped
      const call = (routeMock.mock.calls as any)[0][0];
      expect(call.prompt).toContain("msg-2");    // most recent history IS present
      expect(call.prompt).not.toContain("msg-1"); // oldest history is dropped
    } finally {
      spy.mockRestore();
    }
  });

  it("history messages appear before the current message in the prompt", async () => {
    configureChatBubbleCommands({ getContextLimit: () => 3 });

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "ok", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      await handlers["chat.bubble-send"]({ content: "earlier-turn" });
      routeMock.mockClear();

      await handlers["chat.bubble-send"]({ content: "latest-turn" });

      const call = (routeMock.mock.calls as any)[0][0];
      const prompt: string = call.prompt;
      // Both turns must be present
      expect(prompt).toContain("earlier-turn");
      expect(prompt).toContain("latest-turn");
      // History precedes the current message
      expect(prompt.indexOf("earlier-turn")).toBeLessThan(prompt.indexOf("latest-turn"));
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// chat.bubble-send — default limit
// ---------------------------------------------------------------------------

describe("chat.bubble-send default context limit", () => {
  it("does not throw when no getContextLimit is provided (uses default of 10)", async () => {
    // Given: no getContextLimit option (fresh store)
    configureChatBubbleCommands({});

    const router = await import("../router.ts");
    const routeMock = mock(async () => ({ text: "ok", kind: "claude" as const }));
    const spy = spyOn(router, "route").mockImplementation(
      routeMock as unknown as typeof router.route,
    );

    try {
      // When/Then: sending a message should not throw
      await expect(handlers["chat.bubble-send"]({ content: "first ever" })).resolves.toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
