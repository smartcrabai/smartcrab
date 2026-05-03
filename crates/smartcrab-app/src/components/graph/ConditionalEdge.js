import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { getBezierPath } from '@xyflow/react';
import { EdgeLabel } from './EdgeLabel';
export function ConditionalEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, }) {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });
    return (_jsxs(_Fragment, { children: [_jsx("path", { id: id, className: "react-flow__edge-path", d: edgePath, markerEnd: markerEnd, style: { stroke: '#f97316', strokeWidth: 2 } }), label && (_jsx(EdgeLabel, { x: labelX, y: labelY, label: label, colorClass: "bg-orange-900/80 text-orange-200 border-orange-500" }))] }));
}
