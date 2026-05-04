/**
 * Process-singleton MemoryStore so different command modules
 * (memory.commands, chat-bubble.commands, future learners) all write into
 * the same in-memory + SQLite-backed store.
 *
 * server.ts replaces the default with a DB-backed store at boot via
 * `setSharedMemoryStore(...)`.
 */

import type { Database } from "bun:sqlite";
import { MemoryStore } from "./store.ts";

let shared: MemoryStore = new MemoryStore();

export function getSharedMemoryStore(): MemoryStore {
  return shared;
}

export function setSharedMemoryStore(store: MemoryStore): void {
  shared = store;
}

export function rebindSharedToDb(db: Database): void {
  shared = new MemoryStore(db);
}
