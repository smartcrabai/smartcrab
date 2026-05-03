import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Handle, Position } from '@xyflow/react';
export function OutputLayerNode({ data }) {
    return (_jsxs("div", { className: "px-4 py-2 rounded-lg border-2 border-red-500 bg-red-900/20 min-w-[150px]", children: [_jsx(Handle, { type: "target", position: Position.Top, className: "w-3 h-3 bg-red-500" }), _jsx("div", { className: "text-xs font-medium text-red-400 uppercase tracking-wide", children: "Output" }), _jsx("div", { className: "text-white font-semibold", children: data.label })] }));
}
