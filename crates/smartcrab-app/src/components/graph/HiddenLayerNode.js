import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Handle, Position } from '@xyflow/react';
import { Brain, Globe, Terminal } from 'lucide-react';
function ActionIcon({ action }) {
    if (!action)
        return null;
    if (action.type === 'llm_call')
        return _jsx(Brain, { className: "w-4 h-4 text-blue-300" });
    if (action.type === 'http_request')
        return _jsx(Globe, { className: "w-4 h-4 text-blue-300" });
    if (action.type === 'shell_command')
        return _jsx(Terminal, { className: "w-4 h-4 text-blue-300" });
    return null;
}
function actionTypeLabel(action) {
    if (!action)
        return '';
    if (action.type === 'llm_call')
        return `LLM (${action.provider})`;
    if (action.type === 'http_request')
        return `HTTP ${action.method}`;
    if (action.type === 'shell_command')
        return 'Shell';
    return '';
}
export function HiddenLayerNode({ data }) {
    const action = data.action;
    return (_jsxs("div", { className: "px-4 py-2 rounded-lg border-2 border-blue-500 bg-blue-900/20 min-w-[150px]", children: [_jsx(Handle, { type: "target", position: Position.Top, className: "w-3 h-3 bg-blue-500" }), _jsxs("div", { className: "text-xs font-medium text-blue-400 uppercase tracking-wide flex items-center gap-1", children: [_jsx(ActionIcon, { action: action }), _jsx("span", { children: actionTypeLabel(action) || 'Hidden' })] }), _jsx("div", { className: "text-white font-semibold", children: data.label }), _jsx(Handle, { type: "source", position: Position.Bottom, className: "w-3 h-3 bg-blue-500" })] }));
}
