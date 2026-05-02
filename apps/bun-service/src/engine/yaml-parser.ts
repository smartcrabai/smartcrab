/**
 * TypeScript port of `crates/smartcrab-app/src-tauri/src/engine/yaml_parser.rs`.
 *
 * Parses a pipeline YAML string into a `ResolvedPipeline` (definition plus a
 * map of resolved node kinds: Input/Hidden/Output) using the same topological
 * rules as the Rust implementation.
 */

import { parse as parseYaml } from "yaml";
import type {
  Condition,
  NodeDefinition,
  NodeKind,
  PipelineDefinition,
  ResolvedPipeline,
} from "./yaml-schema.ts";

/**
 * Parse a YAML pipeline definition string.
 *
 * @throws if YAML is malformed or required fields are missing.
 */
export function parsePipeline(yaml: string): ResolvedPipeline {
  const raw: unknown = parseYaml(yaml);
  const definition = validatePipelineDefinition(raw);
  const nodeTypes = resolveNodeTypes(definition.nodes);
  return { definition, nodeTypes };
}

function validatePipelineDefinition(raw: unknown): PipelineDefinition {
  if (raw === null || typeof raw !== "object") {
    throw new Error("pipeline YAML must be a mapping");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string") {
    throw new Error("pipeline YAML missing required string field: name");
  }
  if (obj.trigger === undefined || obj.trigger === null) {
    throw new Error("pipeline YAML missing required field: trigger");
  }
  const nodes = obj.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error("pipeline YAML field 'nodes' must be a list");
  }
  for (const node of nodes) {
    if (
      node === null ||
      typeof node !== "object" ||
      typeof (node as { id?: unknown }).id !== "string" ||
      typeof (node as { name?: unknown }).name !== "string"
    ) {
      throw new Error("each node must have string 'id' and 'name'");
    }
  }
  // Trust the rest matches the schema; YAML validation is intentionally
  // lightweight and matches the original serde behavior (failures bubble up
  // when the pipeline runs).
  return obj as unknown as PipelineDefinition;
}

function resolveNodeTypes(nodes: NodeDefinition[]): Map<string, NodeKind> {
  const referenced = new Set<string>();
  for (const node of nodes) {
    if (node.next !== undefined) {
      if (typeof node.next === "string") {
        referenced.add(node.next);
      } else {
        for (const id of node.next) referenced.add(id);
      }
    }
    if (node.conditions) {
      for (const c of node.conditions as Condition[]) {
        referenced.add(c.next);
      }
    }
  }

  const result = new Map<string, NodeKind>();
  for (const node of nodes) {
    const isReferenced = referenced.has(node.id);
    const hasRouting =
      node.next !== undefined ||
      (Array.isArray(node.conditions) && node.conditions.length > 0);
    let kind: NodeKind;
    if (!isReferenced) {
      kind = "Input";
    } else if (hasRouting) {
      kind = "Hidden";
    } else {
      kind = "Output";
    }
    result.set(node.id, kind);
  }
  return result;
}
