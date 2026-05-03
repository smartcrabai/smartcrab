import { chatRegistry as coreRegistry } from "../../registry";

export interface ChatCapabilities {
  streaming: boolean;
  channels: string[];
}

export interface ChatSendArgs {
  channel: string;
  body: string;
}

export interface ChatAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ChatCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(args: ChatSendArgs): Promise<void>;
  isRunning(): boolean;
}

export class ChatRegistry {
  private adapters = new Map<string, ChatAdapter>();

  register(adapter: ChatAdapter): void {
    this.adapters.set(adapter.id, adapter);
    coreRegistry.register(adapter);
  }

  get(id: string): ChatAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ChatAdapter[] {
    return Array.from(this.adapters.values());
  }

  clear(): void {
    this.adapters.clear();
    coreRegistry.clear();
  }
}

const REGISTRY_KEY = Symbol.for("@smartcrab/bun-service/chat-registry");

interface GlobalRegistryHost {
  [REGISTRY_KEY]?: ChatRegistry;
}

const host = globalThis as GlobalRegistryHost;
if (!host[REGISTRY_KEY]) {
  host[REGISTRY_KEY] = new ChatRegistry();
}

export const chatRegistry: ChatRegistry = host[REGISTRY_KEY]!;
