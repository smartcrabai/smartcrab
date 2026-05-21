import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { runMigrations } from "../db/index.ts";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  createSqlitePairingStore,
  type PairingStore,
} from "../adapters/chat/pairing-store.ts";

const ADAPTER = "discord";

function freshStore(): { db: Database; store: PairingStore } {
  const db = new Database(":memory:");
  runMigrations(db);
  return { db, store: createSqlitePairingStore(db) };
}

describe("SqlitePairingStore", () => {
  let db: Database;
  let store: PairingStore;

  beforeEach(() => {
    ({ db, store } = freshStore());
  });

  it("issues a new code on first upsert and reuses it on repeat", () => {
    const first = store.upsertRequest({ adapterId: ADAPTER, senderId: "u1" });
    expect(first.created).toBe(true);
    expect(first.code).toMatch(
      new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`),
    );

    const second = store.upsertRequest({ adapterId: ADAPTER, senderId: "u1" });
    expect(second.created).toBe(false);
    expect(second.code).toBe(first.code);
  });

  it("persists meta supplied at upsert time", () => {
    store.upsertRequest({
      adapterId: ADAPTER,
      senderId: "u1",
      meta: { name: "alice", tag: "alice#0001", junk: undefined },
    });
    const [req] = store.listRequests(ADAPTER);
    expect(req?.meta.name).toBe("alice");
    expect(req?.meta.tag).toBe("alice#0001");
    expect(req?.meta.junk).toBeUndefined();
  });

  it("approveCode moves the sender to the allowlist and clears the request", () => {
    const { code } = store.upsertRequest({
      adapterId: ADAPTER,
      senderId: "u1",
      meta: { tag: "alice#0001" },
    });
    const entry = store.approveCode(ADAPTER, code);
    expect(entry).not.toBeNull();
    expect(entry?.senderId).toBe("u1");
    expect(entry?.meta.tag).toBe("alice#0001");

    expect(store.listRequests(ADAPTER)).toHaveLength(0);
    expect(store.isAllowed(ADAPTER, "u1")).toBe(true);
    expect(store.listAllowlist(ADAPTER)).toHaveLength(1);
  });

  it("approveCode is case-insensitive", () => {
    const { code } = store.upsertRequest({ adapterId: ADAPTER, senderId: "u1" });
    const result = store.approveCode(ADAPTER, code.toLowerCase());
    expect(result?.senderId).toBe("u1");
  });

  it("approveCode returns null for unknown codes", () => {
    expect(store.approveCode(ADAPTER, "NOPE9999")).toBeNull();
  });

  it("removeRequestByCode and removeRequestBySender drop pending entries", () => {
    const { code } = store.upsertRequest({ adapterId: ADAPTER, senderId: "u1" });
    store.upsertRequest({ adapterId: ADAPTER, senderId: "u2" });
    expect(store.removeRequestByCode(ADAPTER, code)).toBe(true);
    expect(store.removeRequestByCode(ADAPTER, code)).toBe(false);
    expect(store.removeRequestBySender(ADAPTER, "u2")).toBe(true);
    expect(store.listRequests(ADAPTER)).toHaveLength(0);
  });

  it("removeFromAllowlist removes approved entries", () => {
    const { code } = store.upsertRequest({ adapterId: ADAPTER, senderId: "u1" });
    store.approveCode(ADAPTER, code);
    expect(store.removeFromAllowlist(ADAPTER, "u1")).toBe(true);
    expect(store.isAllowed(ADAPTER, "u1")).toBe(false);
  });

  it("prunes pending requests older than the TTL on the next write", () => {
    // Insert a record straight into the table dated >1h ago, bypassing the
    // write path so `lastPrunedAt` stays unset.
    const ancient = Date.now() - 2 * 60 * 60 * 1000;
    db.run(
      "INSERT INTO chat_pairing_requests (adapter_id, sender_id, code, meta_json, created_at, last_seen_at) VALUES (?1, 'u-old', 'OLDCODE1', '{}', ?2, ?2)",
      [ADAPTER, ancient],
    );
    // Any write path force-prunes; the upsert here triggers the sweep.
    store.upsertRequest({ adapterId: ADAPTER, senderId: "u-fresh" });
    const remaining = store.listRequests(ADAPTER).map((r) => r.senderId);
    expect(remaining).toEqual(["u-fresh"]);
  });

  it("scopes records by adapter id", () => {
    store.upsertRequest({ adapterId: ADAPTER, senderId: "u1" });
    store.upsertRequest({ adapterId: "other", senderId: "u1" });
    expect(store.listRequests(ADAPTER)).toHaveLength(1);
    expect(store.listRequests("other")).toHaveLength(1);
  });

  it("isAllowed returns false for senders that were never approved", () => {
    // Regression: bun:sqlite's .get() returns `undefined` for no match, so
    // `row !== null` was always true and admitted every sender.
    expect(store.isAllowed(ADAPTER, "ghost")).toBe(false);
    store.upsertRequest({ adapterId: ADAPTER, senderId: "ghost" });
    expect(store.isAllowed(ADAPTER, "ghost")).toBe(false);
  });
});
