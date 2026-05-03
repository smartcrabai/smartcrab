import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Send } from 'lucide-react';
export function ChatInput({ onSend, disabled }) {
    const [value, setValue] = useState('');
    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }
    function submit() {
        if (value.trim() && !disabled) {
            onSend(value.trim());
            setValue('');
        }
    }
    return (_jsxs("div", { className: "p-4 bg-gray-800 border-t border-gray-700 flex gap-2", children: [_jsx("textarea", { className: "flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", rows: 3, value: value, onChange: e => setValue(e.target.value), onKeyDown: handleKeyDown, disabled: disabled, placeholder: "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u306E\u8AAC\u660E\u3092\u5165\u529B... (Enter\u3067\u9001\u4FE1\u3001Shift+Enter\u3067\u6539\u884C)" }), _jsx("button", { onClick: submit, disabled: disabled || !value.trim(), className: "px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg", children: _jsx(Send, { size: 18 }) })] }));
}
