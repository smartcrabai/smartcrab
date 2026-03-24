import { parse, stringify } from 'yaml';
import type { Node, Edge } from '@xyflow/react';
import type { NodeDefinition, NodeType, PipelineDefinition, MatchCondition, NodeAction } from '../types';

function resolveNodeTypes(nodes: NodeDefinition[]): Record<string, NodeType> {
  const referenced = new Set<string>();
  for (const node of nodes) {
    if (typeof node.next === 'string') referenced.add(node.next);
    else if (Array.isArray(node.next)) node.next.forEach(id => referenced.add(id));
    node.conditions?.forEach(c => referenced.add(c.next));
  }
  const result: Record<string, NodeType> = {};
  for (const node of nodes) {
    const isRef = referenced.has(node.id);
    const hasRouting = !!node.next || (node.conditions?.length ?? 0) > 0;
    result[node.id] = !isRef ? 'input' : hasRouting ? 'hidden' : 'output';
  }
  return result;
}

function autoLayout(nodes: NodeDefinition[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  let y = 0;
  for (const node of nodes) {
    positions[node.id] = { x: 250, y };
    y += 150;
  }
  return positions;
}

export function yamlToReactFlow(yamlContent: string): { nodes: Node[]; edges: Edge[] } {
  const def = parse(yamlContent) as PipelineDefinition;
  const nodeTypes = resolveNodeTypes(def.nodes);
  const positions = autoLayout(def.nodes);

  const rfNodes: Node[] = def.nodes.map(node => ({
    id: node.id,
    type: nodeTypes[node.id] ?? 'hidden',
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: { label: node.name, action: node.action, nodeType: nodeTypes[node.id] },
  }));

  const rfEdges: Edge[] = [];
  let edgeId = 0;

  for (const node of def.nodes) {
    if (node.next) {
      const targets = typeof node.next === 'string' ? [node.next] : node.next;
      for (const target of targets) {
        rfEdges.push({ id: `e-${edgeId++}`, source: node.id, target, type: 'default' });
      }
    }
    for (const cond of node.conditions ?? []) {
      rfEdges.push({
        id: `e-${edgeId++}`,
        source: node.id,
        target: cond.next,
        type: cond.next === node.id ? 'loop' : 'conditional',
        data: { condition: cond.match },
        label: conditionLabel(cond.match),
      });
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}

function conditionLabel(match: { type: string; pattern?: string; codes?: number[] }): string {
  if (match.type === 'regex') return `regex: ${match.pattern}`;
  if (match.type === 'status_code') return `status: ${match.codes?.join(',')}`;
  if (match.type === 'exit_when') return `exit: ${match.pattern}`;
  return match.type;
}

export function reactFlowToYaml(nodes: Node[], edges: Edge[], meta: Partial<PipelineDefinition>): string {
  const nodeMap = new Map<string, NodeDefinition>(
    nodes.map(n => [n.id, { id: n.id, name: n.data.label as string, action: n.data.action as NodeAction }]),
  );

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) continue;

    if (edge.type === 'conditional' || edge.type === 'loop') {
      sourceNode.conditions = sourceNode.conditions ?? [];
      sourceNode.conditions.push({ match: edge.data?.condition as MatchCondition, next: edge.target });
    } else {
      if (!sourceNode.next) sourceNode.next = edge.target;
      else if (typeof sourceNode.next === 'string') sourceNode.next = [sourceNode.next, edge.target];
      else sourceNode.next = [...sourceNode.next, edge.target];
    }
  }

  const def: PipelineDefinition = {
    name: meta.name ?? 'pipeline',
    version: meta.version ?? '1.0',
    trigger: meta.trigger ?? { type: 'discord', triggers: ['mention'] },
    max_loop_count: meta.max_loop_count,
    nodes: Array.from(nodeMap.values()),
  };

  return stringify(def);
}
