#!/usr/bin/env bun
/**
 * Hand-rolled TS → Swift Codable emitter.
 *
 * Output: `apps/macos/Sources/Core/Generated/RPCTypes.swift`
 * (path resolved relative to the repo root, two levels up from this package).
 *
 * The schema definitions here mirror `src/methods.ts` and `src/adapters.ts`.
 * They are intentionally hand-written to keep the toolchain dependency-free.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RPC_METHOD_NAMES } from "../src/methods.ts";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");
const DEFAULT_OUT = join(
  REPO_ROOT,
  "apps",
  "macos",
  "Sources",
  "Core",
  "Generated",
  "RPCTypes.swift",
);

// ─── Type model ───────────────────────────────────────────────────────────

type SwiftType =
  | { kind: "scalar"; name: string }
  | { kind: "optional"; inner: SwiftType }
  | { kind: "array"; element: SwiftType }
  | { kind: "named"; name: string };

const t = {
  string: { kind: "scalar", name: "String" } as SwiftType,
  int: { kind: "scalar", name: "Int" } as SwiftType,
  int64: { kind: "scalar", name: "Int64" } as SwiftType,
  double: { kind: "scalar", name: "Double" } as SwiftType,
  bool: { kind: "scalar", name: "Bool" } as SwiftType,
  /** ISO-8601 timestamp; carried as String to preserve precision and timezone. */
  date: { kind: "scalar", name: "String" } as SwiftType,
  jsonObject: { kind: "scalar", name: "[String: JSONValue]" } as SwiftType,
  optional(inner: SwiftType): SwiftType {
    return { kind: "optional", inner };
  },
  array(element: SwiftType): SwiftType {
    return { kind: "array", element };
  },
  named(name: string): SwiftType {
    return { kind: "named", name };
  },
};

interface StructField {
  name: string;
  type: SwiftType;
  doc?: string;
}

interface StructDef {
  kind: "struct";
  name: string;
  fields: StructField[];
  doc?: string;
}

interface EnumDef {
  kind: "enum";
  name: string;
  cases: Array<{ swift: string; raw: string }>;
  doc?: string;
}

type TypeDef = StructDef | EnumDef;

// ─── Render ───────────────────────────────────────────────────────────────

function renderType(ty: SwiftType): string {
  switch (ty.kind) {
    case "scalar":
      return ty.name;
    case "named":
      return ty.name;
    case "array":
      return `[${renderType(ty.element)}]`;
    case "optional":
      return `${renderType(ty.inner)}?`;
  }
}

function renderStruct(def: StructDef): string {
  const lines: string[] = [];
  if (def.doc) lines.push(`/// ${def.doc}`);
  lines.push(`public struct ${def.name}: Codable, Sendable, Equatable {`);
  for (const f of def.fields) {
    if (f.doc) lines.push(`    /// ${f.doc}`);
    lines.push(`    public var ${f.name}: ${renderType(f.type)}`);
  }
  lines.push("");
  // Memberwise public init (Swift's synthesized init is internal).
  const params = def.fields
    .map((f) => {
      const ty = renderType(f.type);
      const defaultValue = f.type.kind === "optional" ? " = nil" : "";
      return `${f.name}: ${ty}${defaultValue}`;
    })
    .join(", ");
  lines.push(`    public init(${params}) {`);
  for (const f of def.fields) {
    lines.push(`        self.${f.name} = ${f.name}`);
  }
  lines.push("    }");
  lines.push("}");
  return lines.join("\n");
}

function renderEnum(def: EnumDef): string {
  const lines: string[] = [];
  if (def.doc) lines.push(`/// ${def.doc}`);
  lines.push(
    `public enum ${def.name}: String, Codable, Sendable, CaseIterable {`,
  );
  for (const c of def.cases) {
    lines.push(`    case ${c.swift} = "${c.raw}"`);
  }
  lines.push("}");
  return lines.join("\n");
}

function renderTypeDef(def: TypeDef): string {
  return def.kind === "struct" ? renderStruct(def) : renderEnum(def);
}

// ─── Type catalog (mirrors methods.ts / adapters.ts) ──────────────────────

const TYPES: TypeDef[] = [
  // Enums
  {
    kind: "enum",
    name: "ExecutionTrigger",
    doc: "Pipeline trigger source.",
    cases: [
      { swift: "manual", raw: "manual" },
      { swift: "cron", raw: "cron" },
      { swift: "chat", raw: "chat" },
      { swift: "api", raw: "api" },
    ],
  },
  {
    kind: "enum",
    name: "ExecutionStatus",
    doc: "Pipeline execution status.",
    cases: [
      { swift: "pending", raw: "pending" },
      { swift: "running", raw: "running" },
      { swift: "succeeded", raw: "succeeded" },
      { swift: "failed", raw: "failed" },
      { swift: "cancelled", raw: "cancelled" },
    ],
  },
  {
    kind: "enum",
    name: "LogLevel",
    doc: "Log severity.",
    cases: [
      { swift: "trace", raw: "trace" },
      { swift: "debug", raw: "debug" },
      { swift: "info", raw: "info" },
      { swift: "warn", raw: "warn" },
      { swift: "error", raw: "error" },
    ],
  },
  {
    kind: "enum",
    name: "SkillType",
    doc: "Skill kind.",
    cases: [
      { swift: "pipeline", raw: "pipeline" },
      { swift: "script", raw: "script" },
      { swift: "builtin", raw: "builtin" },
    ],
  },
  // Structs
  {
    kind: "struct",
    name: "Pipeline",
    doc: "Pipeline definition.",
    fields: [
      { name: "id", type: t.string },
      { name: "name", type: t.string },
      { name: "description", type: t.optional(t.string) },
      { name: "yamlContent", type: t.string },
      { name: "maxLoopCount", type: t.int },
      { name: "createdAt", type: t.date },
      { name: "updatedAt", type: t.date },
      { name: "isActive", type: t.bool },
    ],
  },
  {
    kind: "struct",
    name: "Execution",
    doc: "Pipeline execution record.",
    fields: [
      { name: "id", type: t.string },
      { name: "pipelineId", type: t.string },
      { name: "triggerType", type: t.named("ExecutionTrigger") },
      { name: "triggerData", type: t.optional(t.string) },
      { name: "status", type: t.named("ExecutionStatus") },
      { name: "startedAt", type: t.date },
      { name: "completedAt", type: t.optional(t.date) },
      { name: "errorMessage", type: t.optional(t.string) },
    ],
  },
  {
    kind: "struct",
    name: "NodeExecution",
    doc: "Per-node execution record.",
    fields: [
      { name: "id", type: t.string },
      { name: "executionId", type: t.string },
      { name: "nodeId", type: t.string },
      { name: "nodeName", type: t.string },
      { name: "iteration", type: t.int },
      { name: "status", type: t.named("ExecutionStatus") },
      { name: "inputData", type: t.optional(t.string) },
      { name: "outputData", type: t.optional(t.string) },
      { name: "startedAt", type: t.date },
      { name: "completedAt", type: t.optional(t.date) },
      { name: "errorMessage", type: t.optional(t.string) },
    ],
  },
  {
    kind: "struct",
    name: "ExecutionLog",
    doc: "Execution log entry.",
    fields: [
      { name: "id", type: t.int64 },
      { name: "executionId", type: t.string },
      { name: "nodeId", type: t.optional(t.string) },
      { name: "level", type: t.named("LogLevel") },
      { name: "message", type: t.string },
      { name: "timestamp", type: t.date },
    ],
  },
  {
    kind: "struct",
    name: "CronJob",
    doc: "Cron job entry.",
    fields: [
      { name: "id", type: t.string },
      { name: "pipelineId", type: t.string },
      { name: "schedule", type: t.string },
      { name: "isActive", type: t.bool },
      { name: "lastRunAt", type: t.optional(t.date) },
      { name: "nextRunAt", type: t.optional(t.date) },
      { name: "createdAt", type: t.optional(t.date) },
      { name: "updatedAt", type: t.optional(t.date) },
    ],
  },
  {
    kind: "struct",
    name: "ChatMessage",
    doc: "Normalized chat message.",
    fields: [
      { name: "channelId", type: t.string },
      { name: "content", type: t.string },
      { name: "author", type: t.optional(t.string) },
      { name: "metadata", type: t.optional(t.jsonObject) },
    ],
  },
  {
    kind: "struct",
    name: "Skill",
    doc: "Skill definition.",
    fields: [
      { name: "id", type: t.string },
      { name: "name", type: t.string },
      { name: "description", type: t.optional(t.string) },
      { name: "filePath", type: t.string },
      { name: "skillType", type: t.named("SkillType") },
      { name: "pipelineId", type: t.optional(t.string) },
      { name: "createdAt", type: t.date },
      { name: "updatedAt", type: t.date },
    ],
  },
  {
    kind: "struct",
    name: "MemoryEntry",
    doc: "Memory entry.",
    fields: [
      { name: "id", type: t.string },
      { name: "content", type: t.string },
      { name: "embedding", type: t.optional(t.array(t.double)) },
      { name: "tags", type: t.array(t.string) },
      { name: "createdAt", type: t.date },
      { name: "updatedAt", type: t.date },
    ],
  },
  {
    kind: "struct",
    name: "Settings",
    doc: "Settings record.",
    fields: [
      { name: "activeChatAdapterId", type: t.optional(t.string) },
      { name: "activeLlmAdapterId", type: t.optional(t.string) },
      { name: "preferences", type: t.jsonObject },
    ],
  },
  // Adapter capability/value types
  {
    kind: "struct",
    name: "LlmCapabilities",
    doc: "Declares what an LLM provider can do.",
    fields: [
      { name: "streaming", type: t.bool },
      { name: "functionCalling", type: t.bool },
      { name: "maxContextTokens", type: t.int64 },
    ],
  },
  {
    kind: "struct",
    name: "LlmRequest",
    doc: "Normalized LLM prompt request.",
    fields: [
      { name: "prompt", type: t.string },
      { name: "timeoutSecs", type: t.optional(t.int64) },
      { name: "metadata", type: t.optional(t.jsonObject) },
    ],
  },
  {
    kind: "struct",
    name: "LlmResponse",
    doc: "Normalized LLM response.",
    fields: [
      { name: "content", type: t.string },
      { name: "metadata", type: t.optional(t.jsonObject) },
    ],
  },
  {
    kind: "struct",
    name: "ChatCapabilities",
    doc: "Declares what a chat platform can do.",
    fields: [
      { name: "threads", type: t.bool },
      { name: "reactions", type: t.bool },
      { name: "fileUpload", type: t.bool },
      { name: "streaming", type: t.bool },
      { name: "directMessage", type: t.bool },
      { name: "groupMessage", type: t.bool },
    ],
  },
];

// ─── Preamble (JSON-RPC envelope + JSONValue helper) ──────────────────────

const PREAMBLE = `// ============================================================================
// THIS FILE IS GENERATED BY scripts/gen-swift.ts. DO NOT EDIT BY HAND.
// Source: packages/ipc-protocol
// ============================================================================

import Foundation

/// JSON-RPC 2.0 protocol version literal.
public let JSONRPC_VERSION: String = "2.0"

/// A type-erased JSON value for free-form metadata fields.
public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(
            in: c, debugDescription: "Unsupported JSON value"
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

/// JSON-RPC id (string, integer, or null).
public enum JSONRPCId: Codable, Sendable, Equatable {
    case string(String)
    case number(Int64)
    case null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let n = try? c.decode(Int64.self) { self = .number(n); return }
        throw DecodingError.dataCorruptedError(
            in: c, debugDescription: "Unsupported JSON-RPC id"
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        }
    }
}

/// JSON-RPC error payload.
public struct JSONRPCError: Codable, Sendable, Equatable {
    public var code: Int
    public var message: String
    public var data: JSONValue?

    public init(code: Int, message: String, data: JSONValue? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }
}
`;

const RPC_METHODS_PREAMBLE = `
// ─── RPC method names ───────────────────────────────────────────────────────

/// All known RPC method names. Mirrors \`RPC_METHOD_NAMES\` in TypeScript.
public enum RPCMethod: String, CaseIterable, Sendable {
__CASES__
}
`;

// ─── Build the file ───────────────────────────────────────────────────────

function buildSource(methodNames: readonly string[]): string {
  const parts: string[] = [PREAMBLE.trimEnd(), ""];
  for (const def of TYPES) {
    parts.push(renderTypeDef(def));
    parts.push("");
  }

  const cases = methodNames
    .map((name) => `    case ${swiftCaseName(name)} = "${name}"`)
    .join("\n");
  parts.push(RPC_METHODS_PREAMBLE.replace("__CASES__", cases).trim());
  parts.push("");
  return `${parts.join("\n")}\n`;
}

function swiftCaseName(method: string): string {
  // "pipeline.list" → "pipelineList"; "cron.run-now" → "cronRunNow"
  return method
    .split(/[.\-]/)
    .map((part, idx) =>
      idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

export async function emitSwift(
  outPath: string = DEFAULT_OUT,
  methodNames: readonly string[] = RPC_METHOD_NAMES,
): Promise<string> {
  const source = buildSource(methodNames);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, source, "utf8");
  return outPath;
}

if (import.meta.main) {
  const path = await emitSwift();
  console.log(`Wrote Swift source to ${path}`);
}
