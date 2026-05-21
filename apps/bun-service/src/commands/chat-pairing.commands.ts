/**
 * JSON-RPC commands backing the SwiftUI DM pairing UI: list, approve,
 * reject, and revoke senders against the shared `PairingStore`.
 */

import { DISCORD_ADAPTER_ID } from "../adapters/chat/discord/types.ts";
import {
  type AllowlistEntry,
  type PairingRequest,
  type PairingStore,
} from "../adapters/chat/pairing-store.ts";

interface ChatPairingContext {
  store: PairingStore;
}

let currentContext: ChatPairingContext | null = null;

export function configureChatPairingCommands(ctx: ChatPairingContext): void {
  currentContext = ctx;
}

function requireContext(): ChatPairingContext {
  if (!currentContext) {
    throw new Error(
      "chat-pairing.commands not configured: call configureChatPairingCommands(ctx) at startup",
    );
  }
  return currentContext;
}

interface AdapterParam {
  adapter?: string;
}
interface ApproveParams extends AdapterParam {
  code: string;
}
interface RevokeRequestParams extends AdapterParam {
  /** Approve-or-revoke supports either the code or the underlying sender id. */
  code?: string;
  sender_id?: string;
}
interface RevokeAllowlistParams extends AdapterParam {
  sender_id: string;
}

function resolveAdapter(adapter: string | undefined): string {
  const id = (adapter ?? DISCORD_ADAPTER_ID).trim();
  if (!id) throw new Error("chat.pairing: adapter id is required");
  return id;
}

function serializeRequest(r: PairingRequest) {
  return {
    adapter_id: r.adapterId,
    sender_id: r.senderId,
    code: r.code,
    meta: r.meta,
    created_at: r.createdAt,
    last_seen_at: r.lastSeenAt,
  };
}

function serializeAllowlist(e: AllowlistEntry) {
  return {
    adapter_id: e.adapterId,
    sender_id: e.senderId,
    meta: e.meta,
    approved_at: e.approvedAt,
  };
}

const handlers = {
  "chat.pairing.list": (params: AdapterParam = {}) => {
    const { store } = requireContext();
    const adapter = resolveAdapter(params.adapter);
    return { requests: store.listRequests(adapter).map(serializeRequest) };
  },

  "chat.pairing.approve": (params: ApproveParams) => {
    const { store } = requireContext();
    const adapter = resolveAdapter(params.adapter);
    if (!params?.code || typeof params.code !== "string") {
      throw new Error("chat.pairing.approve: 'code' is required");
    }
    const entry = store.approveCode(adapter, params.code);
    if (!entry) {
      return { approved: false, entry: null as AllowlistEntry | null };
    }
    return { approved: true, entry: serializeAllowlist(entry) };
  },

  "chat.pairing.reject": (params: RevokeRequestParams) => {
    const { store } = requireContext();
    const adapter = resolveAdapter(params.adapter);
    let removed = false;
    if (params.code) removed = store.removeRequestByCode(adapter, params.code);
    else if (params.sender_id)
      removed = store.removeRequestBySender(adapter, params.sender_id);
    else
      throw new Error("chat.pairing.reject: either 'code' or 'sender_id' is required");
    return { removed };
  },

  "chat.pairing.allowlist": (params: AdapterParam = {}) => {
    const { store } = requireContext();
    const adapter = resolveAdapter(params.adapter);
    return { entries: store.listAllowlist(adapter).map(serializeAllowlist) };
  },

  "chat.pairing.allowlist.remove": (params: RevokeAllowlistParams) => {
    const { store } = requireContext();
    const adapter = resolveAdapter(params.adapter);
    if (!params?.sender_id || typeof params.sender_id !== "string") {
      throw new Error("chat.pairing.allowlist.remove: 'sender_id' is required");
    }
    const removed = store.removeFromAllowlist(adapter, params.sender_id);
    return { removed };
  },
} as const;

export type ChatPairingCommandMap = typeof handlers;
export default handlers;
