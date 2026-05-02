/**
 * Lightweight chat adapter registry stub.
 *
 * This stub exists so Unit 12 (Discord) can self-register without depending
 * on Unit 4's full registry implementation. When the real registry lands,
 * the global symbol-keyed singleton ensures existing adapters keep working.
 */
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
  }

  unregister(id: string): void {
    this.adapters.delete(id);
  }

  get(id: string): ChatAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ChatAdapter[] {
    return Array.from(this.adapters.values());
  }

  clear(): void {
    this.adapters.clear();
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
