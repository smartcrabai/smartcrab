import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

export function OutputLayerNode({ data }: NodeProps) {
  return (
    <div className="px-4 py-2 rounded-lg border-2 border-red-500 bg-red-900/20 min-w-[150px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-red-500" />
      <div className="text-xs font-medium text-red-400 uppercase tracking-wide">Output</div>
      <div className="text-white font-semibold">{data.label as string}</div>
    </div>
  );
}
