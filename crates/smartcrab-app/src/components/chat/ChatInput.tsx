import { useState } from 'react';
import { Send } from 'lucide-react';

export function ChatInput({ onSend, disabled }: { onSend: (s: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');

  function handleKeyDown(e: React.KeyboardEvent) {
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

  return (
    <div className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2">
      <textarea
        className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows={3}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Enter pipeline description... (Enter to send, Shift+Enter for new line)"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg"
      >
        <Send size={18} />
      </button>
    </div>
  );
}
