import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

export function InputLayerNode({ data }: NodeProps) {
  return (
    <div className="px-4 py-2 rounded-lg border-2 border-green-500 bg-green-900/20 min-w-[150px]">
      <div className="text-xs font-medium text-green-400 uppercase tracking-wide">Input</div>
      <div className="text-white font-semibold">{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-green-500" />
    </div>
  );
}
