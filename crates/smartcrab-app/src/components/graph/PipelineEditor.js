import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './nodeTypes';
import { edgeTypes } from './edgeTypes';
import { yamlToReactFlow } from '../../lib/graphConverter';
export function PipelineEditor({ yamlContent, onChange: _onChange, readOnly }) {
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    useEffect(() => {
        try {
            const { nodes: n, edges: e } = yamlToReactFlow(yamlContent);
            setNodes(n);
            setEdges(e);
        }
        catch {
            // invalid yaml - keep current state
        }
    }, [yamlContent]);
    return (_jsx("div", { className: "dark", style: { width: '100%', height: '100%' }, children: _jsxs(ReactFlow, { nodes: nodes, edges: edges, nodeTypes: nodeTypes, edgeTypes: edgeTypes, fitView: true, nodesDraggable: !readOnly, nodesConnectable: !readOnly, children: [_jsx(Background, {}), _jsx(Controls, {}), _jsx(MiniMap, {})] }) }));
}
