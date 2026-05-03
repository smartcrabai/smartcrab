import { chatRegistry } from "../adapters/chat/registry.js";

/**
 * JSON-RPC commands for the chat adapter surface.
 *
 * Ported from `crates/smartcrab-app/src-tauri/src/commands/chat_adapter.rs`.
 * Each command is a thin wrapper that locates the named adapter via
 * `chatRegistry` and forwards. The dispatcher's eager glob expects a default
 * export shaped as `{ "<namespace>.<method>": (params) => Promise<result> }`.
 */
export interface ChatStartParams {
  adapter?: string;
}
export interface ChatStopParams {
  adapter?: string;
}
export interface ChatStatusParams {
  adapter?: string;
}
export interface ChatSendParams {
  adapter?: string;
  channel: string;
  body: string;
}

const DEFAULT_ADAPTER = "discord";

function resolveAdapter(id?: string) {
  const adapterId = id ?? DEFAULT_ADAPTER;
  const adapter = chatRegistry.get(adapterId);
  if (!adapter) {
    throw new Error(`chat adapter '${adapterId}' is not registered`);
  }
  return adapter;
}

export const chatCommands = {
  "chat.start": async (params: ChatStartParams = {}) => {
    const adapter = resolveAdapter(params.adapter);
    await adapter.start();
    return { id: adapter.id, running: adapter.isRunning() };
  },

  "chat.stop": async (params: ChatStopParams = {}) => {
    const adapter = resolveAdapter(params.adapter);
    await adapter.stop();
    return { id: adapter.id, running: adapter.isRunning() };
  },

  "chat.status": async (params: ChatStatusParams = {}) => {
    if (params.adapter) {
      const adapter = resolveAdapter(params.adapter);
      return {
        adapters: [
          {
            id: adapter.id,
            name: adapter.name,
            running: adapter.isRunning(),
            capabilities: adapter.capabilities,
          },
        ],
      };
    }
    return {
      adapters: chatRegistry.list().map((a) => ({
        id: a.id,
        name: a.name,
        running: a.isRunning(),
        capabilities: a.capabilities,
      })),
    };
  },

  "chat.send": async (params: ChatSendParams) => {
    if (!params || typeof params.channel !== "string" || typeof params.body !== "string") {
      throw new Error("chat.send: 'channel' and 'body' are required strings");
    }
    const adapter = resolveAdapter(params.adapter);
    await adapter.send({ channel: params.channel, body: params.body });
    return { ok: true };
  },
};

export default chatCommands;
