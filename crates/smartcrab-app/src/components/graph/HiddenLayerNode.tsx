import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Brain, Globe, Terminal } from 'lucide-react';
import type { NodeAction } from '../../types';

function ActionIcon({ action }: { action?: NodeAction }) {
  if (!action) return null;
  if (action.type === 'llm_call') return <Brain className="w-4 h-4 text-blue-300" />;
  if (action.type === 'http_request') return <Globe className="w-4 h-4 text-blue-300" />;
  if (action.type === 'shell_command') return <Terminal className="w-4 h-4 text-blue-300" />;
  return null;
}

function actionTypeLabel(action?: NodeAction): string {
  if (!action) return '';
  if (action.type === 'llm_call') return `LLM (${action.provider})`;
  if (action.type === 'http_request') return `HTTP ${action.method}`;
  if (action.type === 'shell_command') return 'Shell';
  return '';
}

export function HiddenLayerNode({ data }: NodeProps) {
  const action = data.action as NodeAction | undefined;

  return (
    <div className="px-4 py-2 rounded-lg border-2 border-blue-500 bg-blue-900/20 min-w-[150px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-blue-500" />
      <div className="text-xs font-medium text-blue-400 uppercase tracking-wide flex items-center gap-1">
        <ActionIcon action={action} />
        <span>{actionTypeLabel(action) || 'Hidden'}</span>
      </div>
      <div className="text-white font-semibold">{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-500" />
    </div>
  );
}
