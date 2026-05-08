/**
 * RPC handlers for SmartCrab GUI settings persistence.
 *
 * Methods:
 *   - `settings.app-load` → SeherConfig | null
 *   - `settings.app-save` (config: SeherConfig) → { saved: true }
 *   - `settings.adapter-load` (adapterId: string) → AdapterConfig | null
 *   - `settings.adapter-save` (adapterId: string, config: AdapterConfig) → { saved: true }
 *
 * Backed by the existing `seher_config` and `chat_adapter_config` tables.
 */

import type { Database } from "bun:sqlite";

import { isKimiBackedKind, removeKimiShare } from "../seher/kimi-share.ts";
import {
  writeSeherSettings,
  type InAppSeherConfig,
} from "../seher/write-settings.ts";

interface SettingsContext {
  db: Database;
}

let currentContext: SettingsContext | null = null;

export function configureSettingsCommands(ctx: SettingsContext): void {
  currentContext = ctx;
}

function requireContext(): SettingsContext {
  if (!currentContext) {
    throw new Error(
      "settings.commands not configured: call configureSettingsCommands(ctx) at startup",
    );
  }
  return currentContext;
}

function loadSeherConfig(db: Database): InAppSeherConfig | null {
  const row = db.query<{ config_json: string }, []>(
    "SELECT config_json FROM seher_config WHERE id = 1",
  ).get();
  if (!row) return null;
  try {
    return JSON.parse(row.config_json) as InAppSeherConfig;
  } catch (err) {
    console.error("[settings] failed to parse seher_config JSON:", err);
    return null;
  }
}

const handlers = {
  "settings.app-load": (_params?: unknown): unknown => {
    const { db } = requireContext();
    return loadSeherConfig(db);
  },
  "settings.app-save": (params: { config: unknown }): { saved: true } => {
    const { db } = requireContext();
    const config = params.config as InAppSeherConfig;
    if (!config || !Array.isArray(config.providers)) {
      throw new Error("[settings] invalid config: missing providers array");
    }

    // Load previous config to detect deleted providers.
    const prevConfig = loadSeherConfig(db);

    const json = JSON.stringify(config);
    const now = Math.floor(Date.now() / 1000);
    db.query(
      "INSERT INTO seher_config (id, config_json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at",
    ).run(json, now);
    // Mirror the saved config out to a seher-ts-compatible settings.jsonc so
    // `router.ts`'s SeherSDK reads it on the next chat.bubble-send.
    try {
      writeSeherSettings(config);
    } catch (err) {
      console.error("[settings] failed to write seher-settings.jsonc:", err);
    }

    // Clean up KIMI_SHARE_DIR for deleted kimi-backed providers.
    if (prevConfig) {
      const newIds = new Set(config.providers.map((p) => p.id));
      for (const p of prevConfig.providers) {
        if (!newIds.has(p.id) && isKimiBackedKind(p.kind)) {
          try {
            removeKimiShare(p.id);
          } catch (err) {
            console.error(`[settings] failed to remove kimi-share for "${p.id}":`, err);
          }
        }
      }
    }

    return { saved: true };
  },
  "settings.adapter-load": (params: { adapter_id: string }): unknown => {
    const { db } = requireContext();
    const row = db
      .query<{ config_json: string; enabled: number }, [string]>(
        "SELECT config_json, enabled FROM chat_adapter_config WHERE adapter_id = ?1",
      )
      .get(params.adapter_id);
    if (!row) return null;
    const cfg = JSON.parse(row.config_json) as Record<string, unknown>;
    return { ...cfg, enabled: row.enabled === 1 };
  },
  "settings.adapter-save": (params: {
    adapter_id: string;
    adapter_type?: string;
    config: Record<string, unknown> & { enabled?: boolean };
  }): { saved: true } => {
    const { db } = requireContext();
    const enabled = params.config.enabled ? 1 : 0;
    const cfgWithoutEnabled = { ...params.config };
    delete cfgWithoutEnabled.enabled;
    const json = JSON.stringify(cfgWithoutEnabled);
    const now = Math.floor(Date.now() / 1000);
    db.query(
      "INSERT INTO chat_adapter_config (adapter_id, adapter_type, config_json, enabled, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(adapter_id) DO UPDATE SET adapter_type = excluded.adapter_type, config_json = excluded.config_json, enabled = excluded.enabled, updated_at = excluded.updated_at",
    ).run(params.adapter_id, params.adapter_type ?? params.adapter_id, json, enabled, now);
    return { saved: true };
  },
} as const;

export type SettingsCommandMap = typeof handlers;
export default handlers;
