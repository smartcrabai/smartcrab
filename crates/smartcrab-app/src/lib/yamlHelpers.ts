import { parse, stringify } from 'yaml';
import type { NodeDefinition, NodeType, PipelineDefinition } from '../types';

export function resolveNodeTypes(nodes: NodeDefinition[]): Record<string, NodeType> {
  const referenced = new Set<string>();
  for (const node of nodes) {
    if (typeof node.next === 'string') referenced.add(node.next);
    else if (Array.isArray(node.next)) node.next.forEach((id) => referenced.add(id));
    node.conditions?.forEach((c) => referenced.add(c.next));
  }
  const result: Record<string, NodeType> = {};
  for (const node of nodes) {
    const isRef = referenced.has(node.id);
    const hasRouting = !!node.next || (node.conditions?.length ?? 0) > 0;
    result[node.id] = !isRef ? 'input' : hasRouting ? 'hidden' : 'output';
  }
  return result;
}

export function parsePipelineYaml(yaml: string): PipelineDefinition {
  return parse(yaml) as PipelineDefinition;
}

export function stringifyPipelineYaml(pipeline: PipelineDefinition): string {
  return stringify(pipeline);
}
