#!/usr/bin/env bun
/**
 * Hand-rolled JSON Schema emitter for the RPC method map.
 *
 * Strategy: each method has a small, hand-curated schema. The generator
 * walks `RPC_METHOD_NAMES` and emits one file per method describing both
 * `params` and `result`. We avoid heavy reflection libs to stay portable
 * and keep this script tiny.
 *
 * Output: `dist/schemas/<method>.json`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RPC_METHOD_NAMES, type RpcMethodName } from "../src/methods.ts";

type JsonSchema = Record<string, unknown>;

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(PKG_ROOT, "dist", "schemas");

// ─── Reusable schema fragments ────────────────────────────────────────────

const isoDateTime: JsonSchema = {
  type: "string",
  format: "date-time",
  description: "ISO-8601 timestamp",
};

const nullable = (schema: JsonSchema): JsonSchema => ({
  oneOf: [schema, { type: "null" }],
});

const stringNullable: JsonSchema = nullable({ type: "string" });

const executionStatus: JsonSchema = {
  type: "string",
  enum: ["pending", "running", "succeeded", "failed", "cancelled"],
};

const executionTrigger: JsonSchema = {
  type: "string",
  enum: ["manual", "cron", "chat", "api"],
};

const logLevel: JsonSchema = {
  type: "string",
  enum: ["trace", "debug", "info", "warn", "error"],
};

const skillType: JsonSchema = {
  type: "string",
  enum: ["pipeline", "script", "builtin"],
};

const pipeline: JsonSchema = {
  type: "object",
  required: [
    "id",
    "name",
    "description",
    "yamlContent",
    "maxLoopCount",
    "createdAt",
    "updatedAt",
    "isActive",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: stringNullable,
    yamlContent: { type: "string" },
    maxLoopCount: { type: "integer", minimum: 0 },
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    isActive: { type: "boolean" },
  },
};

const execution: JsonSchema = {
  type: "object",
  required: [
    "id",
    "pipelineId",
    "triggerType",
    "triggerData",
    "status",
    "startedAt",
    "completedAt",
    "errorMessage",
  ],
  properties: {
    id: { type: "string" },
    pipelineId: { type: "string" },
    triggerType: executionTrigger,
    triggerData: stringNullable,
    status: executionStatus,
    startedAt: isoDateTime,
    completedAt: nullable(isoDateTime),
    errorMessage: stringNullable,
  },
};

const executionLog: JsonSchema = {
  type: "object",
  required: ["id", "executionId", "nodeId", "level", "message", "timestamp"],
  properties: {
    id: { type: "integer" },
    executionId: { type: "string" },
    nodeId: stringNullable,
    level: logLevel,
    message: { type: "string" },
    timestamp: isoDateTime,
  },
};

const cronJob: JsonSchema = {
  type: "object",
  required: [
    "id",
    "pipelineId",
    "schedule",
    "isActive",
    "lastRunAt",
    "nextRunAt",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    pipelineId: { type: "string" },
    schedule: { type: "string" },
    isActive: { type: "boolean" },
    lastRunAt: nullable(isoDateTime),
    nextRunAt: nullable(isoDateTime),
    createdAt: nullable(isoDateTime),
    updatedAt: nullable(isoDateTime),
  },
};

const skill: JsonSchema = {
  type: "object",
  required: [
    "id",
    "name",
    "description",
    "filePath",
    "skillType",
    "pipelineId",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: stringNullable,
    filePath: { type: "string" },
    skillType,
    pipelineId: stringNullable,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  },
};

const memoryEntry: JsonSchema = {
  type: "object",
  required: ["id", "content", "embedding", "tags", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    content: { type: "string" },
    embedding: nullable({ type: "array", items: { type: "number" } }),
    tags: { type: "array", items: { type: "string" } },
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  },
};

const settings: JsonSchema = {
  type: "object",
  required: ["activeChatAdapterId", "activeLlmAdapterId", "preferences"],
  properties: {
    activeChatAdapterId: stringNullable,
    activeLlmAdapterId: stringNullable,
    preferences: { type: "object", additionalProperties: true },
  },
};

const empty: JsonSchema = { type: "object", additionalProperties: false };

const obj = (
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema => ({
  type: "object",
  required,
  properties,
  additionalProperties: false,
});

// ─── Per-method schemas ───────────────────────────────────────────────────

const SCHEMAS: Record<RpcMethodName, { params: JsonSchema; result: JsonSchema }> = {
  "system.ping": {
    params: obj([], { message: { type: "string" } }),
    result: obj(["pong", "receivedAt"], {
      pong: { const: true },
      receivedAt: isoDateTime,
    }),
  },
  "pipeline.list": {
    params: obj([], { activeOnly: { type: "boolean" } }),
    result: obj(["pipelines"], {
      pipelines: { type: "array", items: pipeline },
    }),
  },
  "pipeline.get": {
    params: obj(["id"], { id: { type: "string" } }),
    result: obj(["pipeline"], { pipeline }),
  },
  "pipeline.save": {
    params: obj(["name", "yamlContent"], {
      id: { type: "string" },
      name: { type: "string" },
      description: stringNullable,
      yamlContent: { type: "string" },
      maxLoopCount: { type: "integer" },
      isActive: { type: "boolean" },
    }),
    result: obj(["pipeline"], { pipeline }),
  },
  "pipeline.execute": {
    params: obj(["id"], {
      id: { type: "string" },
      triggerType: executionTrigger,
      triggerData: stringNullable,
    }),
    result: obj(["executionId"], { executionId: { type: "string" } }),
  },
  "pipeline.delete": {
    params: obj(["id"], { id: { type: "string" } }),
    result: obj(["deleted"], { deleted: { const: true } }),
  },
  "execution.history": {
    params: obj([], {
      pipelineId: { type: "string" },
      status: executionStatus,
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    result: obj(["executions"], {
      executions: { type: "array", items: execution },
    }),
  },
  "execution.logs": {
    params: obj(["executionId"], {
      executionId: { type: "string" },
      nodeId: { type: "string" },
      level: logLevel,
      limit: { type: "integer" },
    }),
    result: obj(["logs"], { logs: { type: "array", items: executionLog } }),
  },
  "cron.list": {
    params: empty,
    result: obj(["jobs"], { jobs: { type: "array", items: cronJob } }),
  },
  "cron.create": {
    params: obj(["pipelineId", "schedule"], {
      pipelineId: { type: "string" },
      schedule: { type: "string" },
      isActive: { type: "boolean" },
    }),
    result: obj(["job"], { job: cronJob }),
  },
  "cron.update": {
    params: obj(["id"], {
      id: { type: "string" },
      schedule: { type: "string" },
      isActive: { type: "boolean" },
    }),
    result: obj(["job"], { job: cronJob }),
  },
  "cron.delete": {
    params: obj(["id"], { id: { type: "string" } }),
    result: obj(["deleted"], { deleted: { const: true } }),
  },
  "cron.run-now": {
    params: obj(["id"], { id: { type: "string" } }),
    result: obj(["executionId"], { executionId: { type: "string" } }),
  },
  "chat.send": {
    params: obj(["adapterId", "channelId", "content"], {
      adapterId: { type: "string" },
      channelId: { type: "string" },
      content: { type: "string" },
    }),
    result: obj(["sent"], { sent: { const: true } }),
  },
  "chat.start": {
    params: obj(["adapterId"], { adapterId: { type: "string" } }),
    result: obj(["running"], { running: { const: true } }),
  },
  "chat.stop": {
    params: obj(["adapterId"], { adapterId: { type: "string" } }),
    result: obj(["running"], { running: { const: false } }),
  },
  "chat.status": {
    params: obj([], { adapterId: { type: "string" } }),
    result: obj(["adapters"], {
      adapters: {
        type: "array",
        items: obj(["id", "running"], {
          id: { type: "string" },
          running: { type: "boolean" },
        }),
      },
    }),
  },
  "skill.list": {
    params: obj([], { type: skillType }),
    result: obj(["skills"], { skills: { type: "array", items: skill } }),
  },
  "skill.invoke": {
    params: obj(["id"], {
      id: { type: "string" },
      input: { type: "object", additionalProperties: true },
    }),
    result: obj(["output"], { output: {} }),
  },
  "skill.create": {
    params: obj(["name", "filePath", "skillType"], {
      name: { type: "string" },
      description: stringNullable,
      filePath: { type: "string" },
      skillType,
      pipelineId: stringNullable,
    }),
    result: obj(["skill"], { skill }),
  },
  "skill.delete": {
    params: obj(["id"], { id: { type: "string" } }),
    result: obj(["deleted"], { deleted: { const: true } }),
  },
  "memory.search": {
    params: obj(["query"], {
      query: { type: "string" },
      limit: { type: "integer" },
      tags: { type: "array", items: { type: "string" } },
    }),
    result: obj(["entries"], {
      entries: { type: "array", items: memoryEntry },
    }),
  },
  "memory.add": {
    params: obj(["content"], {
      content: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    }),
    result: obj(["entry"], { entry: memoryEntry }),
  },
  "memory.summarize": {
    params: obj(["entryIds"], {
      entryIds: { type: "array", items: { type: "string" } },
      instruction: { type: "string" },
    }),
    result: obj(["summary"], { summary: { type: "string" } }),
  },
  "settings.get": {
    params: empty,
    result: obj(["settings"], { settings }),
  },
  "settings.save": {
    params: obj(["settings"], {
      settings: { type: "object", additionalProperties: true },
    }),
    result: obj(["settings"], { settings }),
  },
};

// ─── Walker ───────────────────────────────────────────────────────────────

export async function emitSchemas(outDir: string = OUT_DIR): Promise<string[]> {
  await mkdir(outDir, { recursive: true });

  return Promise.all(
    RPC_METHOD_NAMES.map(async (method) => {
      const schema = SCHEMAS[method];
      const doc = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: `https://smartcrab.app/schemas/${method}.json`,
        title: method,
        type: "object",
        required: ["params", "result"],
        properties: {
          params: schema.params,
          result: schema.result,
        },
      };
      const path = join(outDir, `${method}.json`);
      await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      return path;
    }),
  );
}

if (import.meta.main) {
  const written = await emitSchemas();
  console.log(`Wrote ${written.length} schema files to ${OUT_DIR}`);
}
