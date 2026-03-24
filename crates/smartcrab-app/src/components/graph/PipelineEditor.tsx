import { useState, useEffect } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './nodeTypes';
import { edgeTypes } from './edgeTypes';
import { yamlToReactFlow } from '../../lib/graphConverter';

interface Props {
  yamlContent: string;
  onChange?: (yaml: string) => void;
  readOnly?: boolean;
}

export function PipelineEditor({ yamlContent, onChange: _onChange, readOnly }: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    try {
      const { nodes: n, edges: e } = yamlToReactFlow(yamlContent);
      setNodes(n);
      setEdges(e);
    } catch {
      // invalid yaml - keep current state
    }
  }, [yamlContent]);

  return (
    <div className="dark" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
