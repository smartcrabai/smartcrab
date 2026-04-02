import ReactMarkdown from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../types';

export function ChatMessage({
  message,
  onOpenInEditor,
}: {
  message: ChatMessageType;
  onOpenInEditor?: (yaml: string) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'
        }`}
      >
        <ReactMarkdown>{message.content}</ReactMarkdown>
        {message.yamlContent && (
          <div className="mt-2 bg-gray-900 rounded p-2">
            <pre className="text-xs text-green-400 overflow-auto">{message.yamlContent}</pre>
            <button
              onClick={() => onOpenInEditor?.(message.yamlContent!)}
              className="mt-1 text-xs text-blue-400 hover:text-blue-300"
            >
              Open in editor &gt;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
