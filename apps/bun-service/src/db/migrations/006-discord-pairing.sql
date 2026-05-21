-- DM pairing + allowlist storage for chat adapters (Discord first).
--
-- chat_pairing_requests holds pending pairing challenges issued to DM
-- senders that are not yet in the allowlist. A request is keyed by
-- (adapter_id, sender_id) so a repeat DM from the same user reuses the
-- existing code rather than spawning a new one every minute.
--
-- chat_dm_allowlist holds approved DM senders. Once a sender appears in
-- this table the adapter routes their DMs to the LLM as before.
--
-- Both tables are managed by src/adapters/chat/pairing-store.ts.

CREATE TABLE IF NOT EXISTS chat_pairing_requests (
    adapter_id    TEXT NOT NULL,
    sender_id     TEXT NOT NULL,
    code          TEXT NOT NULL,
    meta_json     TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    PRIMARY KEY (adapter_id, sender_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_pairing_requests_code
    ON chat_pairing_requests(adapter_id, code);

CREATE TABLE IF NOT EXISTS chat_dm_allowlist (
    adapter_id    TEXT NOT NULL,
    sender_id     TEXT NOT NULL,
    meta_json     TEXT NOT NULL DEFAULT '{}',
    approved_at   INTEGER NOT NULL,
    PRIMARY KEY (adapter_id, sender_id)
);
