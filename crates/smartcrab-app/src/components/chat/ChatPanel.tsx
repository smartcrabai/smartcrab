import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types';

export function ChatPanel({ onOpenInEditor }: { onOpenInEditor?: (yaml: string) => void }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function sendMessage(content: string) {
    const userMsg: ChatMessageType = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    try {
      const response = await invoke<{ message: string; yaml_content?: string }>(
        'chat_create_pipeline',
        { prompt: content },
      );
      const assistantMsg: ChatMessageType = {
        role: 'assistant',
        content: response.message,
        yamlContent: response.yaml_content,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${String(e)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white">AIでパイプラインを作成</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p>パイプラインを自然言語で説明してください。</p>
            <p className="text-sm mt-2">例: 「5分ごとにAPIを確認してエラーならDiscordに通知」</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={`${msg.timestamp}-${i}`} message={msg} onOpenInEditor={onOpenInEditor} />
        ))}
        {isLoading && (
          <div className="text-gray-400 animate-pulse">Claude が考えています...</div>
        )}
      </div>
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
