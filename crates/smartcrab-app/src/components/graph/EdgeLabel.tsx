import { EdgeLabelRenderer } from '@xyflow/react';

interface EdgeLabelProps {
  x: number;
  y: number;
  label: string;
  colorClass: string;
}

export function EdgeLabel({ x, y, label, colorClass }: EdgeLabelProps) {
  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
          pointerEvents: 'all',
        }}
        className={`nodrag nopan px-2 py-0.5 rounded text-xs border ${colorClass}`}
      >
        {label}
      </div>
    </EdgeLabelRenderer>
  );
}
