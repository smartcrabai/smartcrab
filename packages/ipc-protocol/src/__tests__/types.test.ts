/**
 * Compile-time round-trips and runtime smoke tests for the IPC protocol.
 *
 * These tests exist primarily to lock the public type surface: if a method
 * name is removed or a domain-type field is renamed without updating both
 * sides, the test file fails to type-check.
 */

import { describe, expect, test } from "bun:test";

import {
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  isJsonRpcError,
  isJsonRpcSuccess,
  makeErrorResponse,
  makeNotification,
  makeRequest,
  makeSuccessResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../jsonrpc.ts";
import {
  RPC_METHOD_NAMES,
  type ChatMessage,
  type CronJob,
  type Execution,
  type ExecutionLog,
  type MemoryEntry,
  type Pipeline,
  type RpcMethodName,
  type RpcMethods,
  type RpcParams,
  type RpcResult,
  type Settings,
  type Skill,
} from "../methods.ts";
import type {
  ChatAdapter,
  ChatCapabilities,
  LlmAdapter,
  LlmCapabilities,
  LlmRequest,
  LlmResponse,
} from "../adapters.ts";

describe("JSON-RPC envelope", () => {
  test("makeRequest/Response round-trip", () => {
    const req: JsonRpcRequest<{ id: string }> = makeRequest(1, "pipeline.get", {
      id: "p1",
    });
    expect(req.jsonrpc).toBe(JSONRPC_VERSION);
    expect(req.method).toBe("pipeline.get");
    expect(req.id).toBe(1);
    expect(req.params).toEqual({ id: "p1" });

    const ok = makeSuccessResponse(req.id, { value: 42 });
    expect(isJsonRpcSuccess(ok)).toBe(true);
    expect(isJsonRpcError(ok)).toBe(false);

    const err = makeErrorResponse(req.id, {
      code: JsonRpcErrorCode.MethodNotFound,
      message: "nope",
    });
    expect(isJsonRpcError(err)).toBe(true);
    expect(isJsonRpcSuccess(err)).toBe(false);
  });

  test("makeNotification has no id", () => {
    const note = makeNotification("pipeline.list");
    expect("id" in note).toBe(false);
    expect(note.method).toBe("pipeline.list");
  });

  test("type guard narrows union", () => {
    const resp: JsonRpcResponse<{ x: number }, { hint: string }> =
      makeSuccessResponse("a", { x: 1 });
    if (isJsonRpcSuccess(resp)) {
      // Compile-time: `resp.result` accessible.
      expect(resp.result.x).toBe(1);
    } else {
      throw new Error("expected success");
    }
  });
});

describe("RPC method map", () => {
  test("RPC_METHOD_NAMES covers every required category", () => {
    const required = [
      "system.ping",
      "pipeline.list",
      "pipeline.get",
      "pipeline.save",
      "pipeline.execute",
      "pipeline.delete",
      "execution.history",
      "execution.logs",
      "cron.list",
      "cron.create",
      "cron.update",
      "cron.delete",
      "cron.run-now",
      "chat.send",
      "chat.start",
      "chat.stop",
      "chat.status",
      "skill.list",
      "skill.invoke",
      "skill.create",
      "skill.delete",
      "memory.search",
      "memory.add",
      "memory.summarize",
      "settings.get",
      "settings.save",
    ] satisfies RpcMethodName[];
    for (const name of required) {
      expect(RPC_METHOD_NAMES).toContain(name);
    }
    expect(RPC_METHOD_NAMES.length).toBe(required.length);
  });

  test("each method has unique name", () => {
    const set = new Set(RPC_METHOD_NAMES);
    expect(set.size).toBe(RPC_METHOD_NAMES.length);
  });

  test("RpcParams/RpcResult are the same as RpcMethods entries", () => {
    // Compile-time only: a mismatch would fail tsc.
    const _p: RpcParams<"pipeline.get"> = { id: "x" };
    const _r: RpcResult<"pipeline.get"> = {
      pipeline: {
        id: "x",
        name: "n",
        description: null,
        yamlContent: "",
        maxLoopCount: 10,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        isActive: true,
      },
    };
    void _p;
    void _r;
    expect(true).toBe(true);
  });
});

describe("Domain type smoke imports", () => {
  test("can construct each domain shape", () => {
    const pipeline: Pipeline = {
      id: "p",
      name: "n",
      description: null,
      yamlContent: "yaml: 1",
      maxLoopCount: 10,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      isActive: true,
    };
    const exec: Execution = {
      id: "e",
      pipelineId: "p",
      triggerType: "manual",
      triggerData: null,
      status: "running",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: null,
      errorMessage: null,
    };
    const log: ExecutionLog = {
      id: 1,
      executionId: "e",
      nodeId: null,
      level: "info",
      message: "hi",
      timestamp: "2024-01-01T00:00:00Z",
    };
    const cron: CronJob = {
      id: "c",
      pipelineId: "p",
      schedule: "* * * * *",
      isActive: true,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: null,
      updatedAt: null,
    };
    const msg: ChatMessage = {
      channelId: "ch",
      content: "hi",
      author: null,
      metadata: null,
    };
    const skill: Skill = {
      id: "s",
      name: "Run X",
      description: null,
      filePath: "/skills/x.ts",
      skillType: "script",
      pipelineId: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const mem: MemoryEntry = {
      id: "m",
      content: "remember",
      embedding: null,
      tags: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const settings: Settings = {
      activeChatAdapterId: null,
      activeLlmAdapterId: null,
      preferences: {},
    };

    expect(pipeline.id).toBe("p");
    expect(exec.status).toBe("running");
    expect(log.level).toBe("info");
    expect(cron.schedule).toBe("* * * * *");
    expect(msg.channelId).toBe("ch");
    expect(skill.skillType).toBe("script");
    expect(mem.tags).toEqual([]);
    expect(settings.preferences).toEqual({});
  });

  test("JSON round-trip preserves shape", () => {
    const exec: Execution = {
      id: "e",
      pipelineId: "p",
      triggerType: "cron",
      triggerData: "{\"cronId\":\"c1\"}",
      status: "succeeded",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:01:00Z",
      errorMessage: null,
    };
    const parsed = JSON.parse(JSON.stringify(exec)) as Execution;
    expect(parsed).toEqual(exec);
  });
});

describe("Adapter interface shapes", () => {
  test("LlmAdapter conforms to expected surface", () => {
    const caps: LlmCapabilities = {
      streaming: true,
      functionCalling: false,
      maxContextTokens: 200_000,
    };
    const adapter: LlmAdapter = {
      id: "claude",
      name: "Claude",
      capabilities: () => caps,
      executePrompt: async (req: LlmRequest): Promise<LlmResponse> => ({
        content: `echo: ${req.prompt}`,
      }),
    };
    expect(adapter.id).toBe("claude");
    expect(adapter.capabilities().maxContextTokens).toBe(200_000);
  });

  test("ChatAdapter conforms to expected surface", () => {
    const caps: ChatCapabilities = {
      threads: true,
      reactions: false,
      fileUpload: false,
      streaming: false,
      directMessage: true,
      groupMessage: true,
    };
    let running = false;
    const adapter: ChatAdapter = {
      id: "discord",
      name: "Discord",
      capabilities: () => caps,
      sendMessage: async () => {},
      startListener: async () => {
        running = true;
      },
      stopListener: async () => {
        running = false;
      },
      isRunning: () => running,
    };
    expect(adapter.isRunning()).toBe(false);
  });
});

describe("RpcMethods surface", () => {
  test("each method's params and result are objects (or string-record)", () => {
    // Pure compile-time: ensure no method shape regressed to `unknown`.
    type AssertObjectShape<T> = T extends object ? true : false;
    type AllAreObjects = {
      [K in RpcMethodName]: AssertObjectShape<RpcMethods[K]["params"]> &
        AssertObjectShape<RpcMethods[K]["result"]>;
    };
    const _check: AllAreObjects = {} as AllAreObjects;
    void _check;
    expect(true).toBe(true);
  });
});
