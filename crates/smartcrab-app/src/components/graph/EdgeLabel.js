import { jsx as _jsx } from "react/jsx-runtime";
import { EdgeLabelRenderer } from '@xyflow/react';
export function EdgeLabel({ x, y, label, colorClass }) {
    return (_jsx(EdgeLabelRenderer, { children: _jsx("div", { style: {
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
                pointerEvents: 'all',
            }, className: `nodrag nopan px-2 py-0.5 rounded text-xs border ${colorClass}`, children: label }) }));
}
