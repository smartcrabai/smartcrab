import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Handle, Position } from '@xyflow/react';
export function InputLayerNode({ data }) {
    return (_jsxs("div", { className: "px-4 py-2 rounded-lg border-2 border-green-500 bg-green-900/20 min-w-[150px]", children: [_jsx("div", { className: "text-xs font-medium text-green-400 uppercase tracking-wide", children: "Input" }), _jsx("div", { className: "text-white font-semibold", children: data.label }), _jsx(Handle, { type: "source", position: Position.Bottom, className: "w-3 h-3 bg-green-500" })] }));
}
