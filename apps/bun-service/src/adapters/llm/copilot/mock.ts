/**
 * Mock shim for the GitHub Copilot SDK.
 *
 * TODO(Unit 11): swap to the real `@github/copilot-sdk` (or whichever npm
 * name GitHub publishes) once available. Reference:
 * https://github.com/github/copilot-sdk
 *
 * Copilot uses JSON-RPC plus MCP for tool invocation. We model that here as
 * a thin `Client` with a `request(method, params)` JSON-RPC call. The
 * adapter only depends on this surface.
 */

export interface CopilotRpcResult<T = unknown> {
  result?: T;
  error?: { code: number; message: string };
}

export interface CopilotClient {
  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<CopilotRpcResult<T>>;
  close?(): Promise<void> | void;
}

export interface CopilotClientOptions {
  token?: string;
  /** MCP servers to register; mirrored from the real SDK config. */
  mcpServers?: Record<string, { command: string; args?: string[] }>;
}

export interface CopilotSdkLike {
  Client: new (opts?: CopilotClientOptions) => CopilotClient;
}

class MockClient implements CopilotClient {
  constructor(_opts?: CopilotClientOptions) {}
  async request<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<CopilotRpcResult<T>> {
    if (method === "chat.complete") {
      const prompt = (params?.prompt as string | undefined) ?? "";
      return {
        result: { content: `[copilot-mock] ${prompt}` } as unknown as T,
      };
    }
    return { result: { method, params } as unknown as T };
  }
  close(): void {}
}

export const mockCopilotSdk: CopilotSdkLike = {
  Client: MockClient,
};
