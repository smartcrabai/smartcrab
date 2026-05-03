import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
export function ChatPanel({ onOpenInEditor }) {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    async function sendMessage(content) {
        const userMsg = {
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);
        try {
            const response = await invoke('chat_create_pipeline', { prompt: content });
            const assistantMsg = {
                role: 'assistant',
                content: response.message,
                yamlContent: response.yaml_content,
                timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, assistantMsg]);
        }
        catch (e) {
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: `Error: ${String(e)}`,
                    timestamp: new Date().toISOString(),
                },
            ]);
        }
        finally {
            setIsLoading(false);
        }
    }
    return (_jsxs("div", { className: "flex flex-col h-full", children: [_jsx("div", { className: "px-4 py-3 bg-gray-800 border-b border-gray-700", children: _jsx("h2", { className: "text-lg font-semibold text-white", children: "AI\u3067\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u3092\u4F5C\u6210" }) }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4 space-y-4", children: [messages.length === 0 && (_jsxs("div", { className: "text-center text-gray-500 mt-8", children: [_jsx("p", { children: "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u3092\u81EA\u7136\u8A00\u8A9E\u3067\u8AAC\u660E\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }), _jsx("p", { className: "text-sm mt-2", children: "\u4F8B: \u300C5\u5206\u3054\u3068\u306BAPI\u3092\u78BA\u8A8D\u3057\u3066\u30A8\u30E9\u30FC\u306A\u3089Discord\u306B\u901A\u77E5\u300D" })] })), messages.map((msg, i) => (_jsx(ChatMessage, { message: msg, onOpenInEditor: onOpenInEditor }, `${msg.timestamp}-${i}`))), isLoading && (_jsx("div", { className: "text-gray-400 animate-pulse", children: "Claude \u304C\u8003\u3048\u3066\u3044\u307E\u3059..." }))] }), _jsx(ChatInput, { onSend: sendMessage, disabled: isLoading })] }));
}
