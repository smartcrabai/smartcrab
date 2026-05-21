import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { runMigrations } from "../db/index.ts";
import { createSqlitePairingStore } from "../adapters/chat/pairing-store.ts";
import chatPairingCommands, {
  configureChatPairingCommands,
} from "../commands/chat-pairing.commands.ts";

describe("chat.pairing.* commands", () => {
  let store: ReturnType<typeof createSqlitePairingStore>;

  beforeEach(() => {
    const db = new Database(":memory:");
    runMigrations(db);
    store = createSqlitePairingStore(db);
    configureChatPairingCommands({ store });
  });

  it("lists pending requests in creation order", () => {
    store.upsertRequest({ adapterId: "discord", senderId: "u1" });
    store.upsertRequest({ adapterId: "discord", senderId: "u2" });
    const result = chatPairingCommands["chat.pairing.list"]({}) as {
      requests: { sender_id: string }[];
    };
    expect(result.requests.map((r) => r.sender_id)).toEqual(["u1", "u2"]);
  });

  it("approve moves the sender into the allowlist", () => {
    const { code } = store.upsertRequest({ adapterId: "discord", senderId: "u1" });
    const result = chatPairingCommands["chat.pairing.approve"]({ code }) as {
      approved: boolean;
      entry: { sender_id: string } | null;
    };
    expect(result.approved).toBe(true);
    expect(result.entry?.sender_id).toBe("u1");
    const list = chatPairingCommands["chat.pairing.list"]({}) as { requests: unknown[] };
    expect(list.requests).toHaveLength(0);
    const allow = chatPairingCommands["chat.pairing.allowlist"]({}) as {
      entries: { sender_id: string }[];
    };
    expect(allow.entries.map((e) => e.sender_id)).toEqual(["u1"]);
  });

  it("reject removes the pending request without approving", () => {
    const { code } = store.upsertRequest({ adapterId: "discord", senderId: "u1" });
    const result = chatPairingCommands["chat.pairing.reject"]({ code }) as {
      removed: boolean;
    };
    expect(result.removed).toBe(true);
    expect((chatPairingCommands["chat.pairing.list"]({}) as { requests: unknown[] }).requests).toHaveLength(0);
    expect((chatPairingCommands["chat.pairing.allowlist"]({}) as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it("allowlist.remove drops a previously approved sender", () => {
    const { code } = store.upsertRequest({ adapterId: "discord", senderId: "u1" });
    chatPairingCommands["chat.pairing.approve"]({ code });
    const removed = chatPairingCommands["chat.pairing.allowlist.remove"]({
      sender_id: "u1",
    }) as { removed: boolean };
    expect(removed.removed).toBe(true);
    expect(store.isAllowed("discord", "u1")).toBe(false);
  });

  it("approve fails clearly without a code", () => {
    expect(() => chatPairingCommands["chat.pairing.approve"]({} as never)).toThrow(
      /code.*required/,
    );
  });
});
