/**
 * SQLite-backed DM pairing + allowlist store. Inspired by openclaw/openclaw.
 * Schema: `chat_pairing_requests` + `chat_dm_allowlist`
 * (migration 006-discord-pairing.sql).
 */

import { randomInt } from "node:crypto";

import type { Database } from "bun:sqlite";

export const PAIRING_CODE_LENGTH = 8;
/** Avoids ambiguous glyphs (0/O, 1/I) when read off Discord. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_MAX_ATTEMPTS = 500;
const PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
const PAIRING_PENDING_MAX = 16;
/** Minimum wall-clock gap between two prune sweeps on the same adapter.
 *  Keeps the 5s SwiftUI poll from issuing a DELETE on every tick. */
const PAIRING_PRUNE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface PairingRequest {
  adapterId: string;
  senderId: string;
  code: string;
  meta: Record<string, string>;
  createdAt: number;
  lastSeenAt: number;
}

export interface AllowlistEntry {
  adapterId: string;
  senderId: string;
  meta: Record<string, string>;
  approvedAt: number;
}

export interface UpsertRequestArgs {
  adapterId: string;
  senderId: string;
  meta?: Record<string, string | undefined | null>;
}

export interface UpsertRequestResult {
  /** Existing or freshly-issued code. Empty string when the cap was hit. */
  code: string;
  /** True when this call created a brand-new pairing request. */
  created: boolean;
}

export interface PairingStore {
  upsertRequest(args: UpsertRequestArgs): UpsertRequestResult;
  listRequests(adapterId: string): PairingRequest[];
  approveCode(adapterId: string, code: string): AllowlistEntry | null;
  removeRequestByCode(adapterId: string, code: string): boolean;
  removeRequestBySender(adapterId: string, senderId: string): boolean;
  listAllowlist(adapterId: string): AllowlistEntry[];
  isAllowed(adapterId: string, senderId: string): boolean;
  removeFromAllowlist(adapterId: string, senderId: string): boolean;
}

function cleanMeta(
  meta: Record<string, string | undefined | null> | undefined,
): Record<string, string> {
  if (!meta) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

function generateCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < PAIRING_CODE_MAX_ATTEMPTS; attempt += 1) {
    let code = "";
    for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
      code += PAIRING_CODE_ALPHABET[randomInt(0, PAIRING_CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error(
    `failed to generate unique pairing code after ${PAIRING_CODE_MAX_ATTEMPTS} attempts`,
  );
}

interface PairingRow {
  adapter_id: string;
  sender_id: string;
  code: string;
  meta_json: string;
  created_at: number;
  last_seen_at: number;
}

interface AllowlistRow {
  adapter_id: string;
  sender_id: string;
  meta_json: string;
  approved_at: number;
}

function rowToRequest(row: PairingRow): PairingRequest {
  let meta: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.meta_json);
    if (parsed && typeof parsed === "object") {
      meta = parsed as Record<string, string>;
    }
  } catch {
    // tolerate corrupt JSON — drop meta but keep the request usable
  }
  return {
    adapterId: row.adapter_id,
    senderId: row.sender_id,
    code: row.code,
    meta,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function rowToAllowlist(row: AllowlistRow): AllowlistEntry {
  let meta: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.meta_json);
    if (parsed && typeof parsed === "object") {
      meta = parsed as Record<string, string>;
    }
  } catch {
    // ignore
  }
  return {
    adapterId: row.adapter_id,
    senderId: row.sender_id,
    meta,
    approvedAt: row.approved_at,
  };
}

class SqlitePairingStore implements PairingStore {
  private readonly lastPrunedAt = new Map<string, number>();

  constructor(private readonly db: Database) {}

  /**
   * Delete expired pending requests for `adapterId`. The 5s SwiftUI poll
   * otherwise issues a DELETE on every tick; rate-limit to once per
   * `PAIRING_PRUNE_MIN_INTERVAL_MS` per adapter unless `force` is set
   * (e.g. write paths that must observe a fully pruned table).
   */
  private pruneExpired(adapterId: string, nowMs: number, force = false): void {
    if (!force) {
      const last = this.lastPrunedAt.get(adapterId) ?? 0;
      if (nowMs - last < PAIRING_PRUNE_MIN_INTERVAL_MS) return;
    }
    this.db.run(
      "DELETE FROM chat_pairing_requests WHERE adapter_id = ?1 AND ?2 - created_at > ?3",
      [adapterId, nowMs, PAIRING_PENDING_TTL_MS],
    );
    this.lastPrunedAt.set(adapterId, nowMs);
  }

  upsertRequest(args: UpsertRequestArgs): UpsertRequestResult {
    const meta = cleanMeta(args.meta);
    const now = Date.now();
    return this.db.transaction(() => {
      // Force-prune on write paths so the per-adapter pending cap is
      // counted against fresh entries only.
      this.pruneExpired(args.adapterId, now, true);

      const existing = this.db
        .query<PairingRow, [string, string]>(
          "SELECT * FROM chat_pairing_requests WHERE adapter_id = ?1 AND sender_id = ?2",
        )
        .get(args.adapterId, args.senderId);
      if (existing) {
        this.db.run(
          "UPDATE chat_pairing_requests SET last_seen_at = ?1, meta_json = ?2 WHERE adapter_id = ?3 AND sender_id = ?4",
          [now, JSON.stringify(meta), args.adapterId, args.senderId],
        );
        return { code: existing.code, created: false };
      }

      const pendingCount = (this.db
        .query<{ c: number }, [string]>(
          "SELECT COUNT(*) AS c FROM chat_pairing_requests WHERE adapter_id = ?1",
        )
        .get(args.adapterId)?.c ?? 0) as number;
      if (pendingCount >= PAIRING_PENDING_MAX) {
        return { code: "", created: false };
      }

      const existingCodes = new Set<string>(
        this.db
          .query<{ code: string }, [string]>(
            "SELECT code FROM chat_pairing_requests WHERE adapter_id = ?1",
          )
          .all(args.adapterId)
          .map((row) => row.code.toUpperCase()),
      );
      const code = generateCode(existingCodes);
      this.db.run(
        "INSERT INTO chat_pairing_requests (adapter_id, sender_id, code, meta_json, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        [args.adapterId, args.senderId, code, JSON.stringify(meta), now],
      );
      return { code, created: true };
    })();
  }

  listRequests(adapterId: string): PairingRequest[] {
    const now = Date.now();
    this.pruneExpired(adapterId, now);
    return this.db
      .query<PairingRow, [string]>(
        // Tie-break by rowid so two requests created in the same millisecond
        // still come back in insertion order.
        "SELECT * FROM chat_pairing_requests WHERE adapter_id = ?1 ORDER BY created_at ASC, rowid ASC",
      )
      .all(adapterId)
      .map(rowToRequest);
  }

  approveCode(adapterId: string, code: string): AllowlistEntry | null {
    const normalized = (code ?? "").trim().toUpperCase();
    if (!normalized) return null;
    return this.db.transaction(() => {
      this.pruneExpired(adapterId, Date.now(), true);
      const row = this.db
        .query<PairingRow, [string, string]>(
          "SELECT * FROM chat_pairing_requests WHERE adapter_id = ?1 AND code = ?2",
        )
        .get(adapterId, normalized);
      if (!row) return null;
      const request = rowToRequest(row);
      const approvedAt = Date.now();
      this.db.run(
        "INSERT INTO chat_dm_allowlist (adapter_id, sender_id, meta_json, approved_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(adapter_id, sender_id) DO UPDATE SET meta_json = excluded.meta_json, approved_at = excluded.approved_at",
        [adapterId, request.senderId, JSON.stringify(request.meta), approvedAt],
      );
      this.db.run(
        "DELETE FROM chat_pairing_requests WHERE adapter_id = ?1 AND sender_id = ?2",
        [adapterId, request.senderId],
      );
      return {
        adapterId,
        senderId: request.senderId,
        meta: request.meta,
        approvedAt,
      } satisfies AllowlistEntry;
    })();
  }

  removeRequestByCode(adapterId: string, code: string): boolean {
    const normalized = (code ?? "").trim().toUpperCase();
    if (!normalized) return false;
    const result = this.db.run(
      "DELETE FROM chat_pairing_requests WHERE adapter_id = ?1 AND code = ?2",
      [adapterId, normalized],
    );
    return result.changes > 0;
  }

  removeRequestBySender(adapterId: string, senderId: string): boolean {
    if (!senderId) return false;
    const result = this.db.run(
      "DELETE FROM chat_pairing_requests WHERE adapter_id = ?1 AND sender_id = ?2",
      [adapterId, senderId],
    );
    return result.changes > 0;
  }

  listAllowlist(adapterId: string): AllowlistEntry[] {
    return this.db
      .query<AllowlistRow, [string]>(
        "SELECT * FROM chat_dm_allowlist WHERE adapter_id = ?1 ORDER BY approved_at ASC, rowid ASC",
      )
      .all(adapterId)
      .map(rowToAllowlist);
  }

  isAllowed(adapterId: string, senderId: string): boolean {
    if (!senderId) return false;
    const row = this.db
      .query<{ sender_id: string }, [string, string]>(
        "SELECT sender_id FROM chat_dm_allowlist WHERE adapter_id = ?1 AND sender_id = ?2",
      )
      .get(adapterId, senderId);
    return row != null;
  }

  removeFromAllowlist(adapterId: string, senderId: string): boolean {
    if (!senderId) return false;
    const result = this.db.run(
      "DELETE FROM chat_dm_allowlist WHERE adapter_id = ?1 AND sender_id = ?2",
      [adapterId, senderId],
    );
    return result.changes > 0;
  }
}

export function createSqlitePairingStore(db: Database): PairingStore {
  return new SqlitePairingStore(db);
}

/**
 * Module-level handle so the Discord adapter can reach the store without
 * threading the SQLite database through every constructor. `server.ts`
 * sets this at boot once the DB is open.
 */
let currentStore: PairingStore | null = null;

export function setPairingStore(store: PairingStore | null): void {
  currentStore = store;
}

export function getPairingStore(): PairingStore | null {
  return currentStore;
}
