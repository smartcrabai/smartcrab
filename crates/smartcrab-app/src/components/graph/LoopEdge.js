import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { EdgeLabel } from './EdgeLabel';
const LOOP_RADIUS = 40;
export function LoopEdge({ id, sourceX, sourceY, label, markerEnd }) {
    const offsetX = LOOP_RADIUS * 2;
    const d = [
        `M ${sourceX} ${sourceY}`,
        `C ${sourceX + offsetX} ${sourceY - LOOP_RADIUS},`,
        `${sourceX + offsetX + LOOP_RADIUS} ${sourceY},`,
        `${sourceX + LOOP_RADIUS} ${sourceY + LOOP_RADIUS}`,
        `C ${sourceX} ${sourceY + LOOP_RADIUS * 1.5},`,
        `${sourceX - LOOP_RADIUS} ${sourceY + LOOP_RADIUS},`,
        `${sourceX} ${sourceY}`,
    ].join(' ');
    const labelX = sourceX + offsetX + LOOP_RADIUS / 2;
    const labelY = sourceY;
    return (_jsxs(_Fragment, { children: [_jsx("path", { id: id, className: "react-flow__edge-path", d: d, markerEnd: markerEnd, style: { stroke: '#a855f7', strokeWidth: 2, fill: 'none' } }), label && (_jsx(EdgeLabel, { x: labelX, y: labelY, label: label, colorClass: "bg-purple-900/80 text-purple-200 border-purple-500" }))] }));
}
