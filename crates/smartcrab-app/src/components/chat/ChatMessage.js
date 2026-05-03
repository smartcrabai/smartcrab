import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import ReactMarkdown from 'react-markdown';
export function ChatMessage({ message, onOpenInEditor, }) {
    const isUser = message.role === 'user';
    return (_jsx("div", { className: `flex ${isUser ? 'justify-end' : 'justify-start'}`, children: _jsxs("div", { className: `max-w-[80%] rounded-lg px-4 py-2 ${isUser ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'}`, children: [_jsx(ReactMarkdown, { children: message.content }), message.yamlContent && (_jsxs("div", { className: "mt-2 bg-gray-900 rounded p-2", children: [_jsx("pre", { className: "text-xs text-green-400 overflow-auto", children: message.yamlContent }), _jsx("button", { onClick: () => onOpenInEditor?.(message.yamlContent), className: "mt-1 text-xs text-blue-400 hover:text-blue-300", children: "\u30A8\u30C7\u30A3\u30BF\u3067\u958B\u304F \u2192" })] }))] }) }));
}
