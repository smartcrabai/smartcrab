import { getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { EdgeLabel } from './EdgeLabel';

export function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: '#f97316', strokeWidth: 2 }}
      />
      {label && (
        <EdgeLabel
          x={labelX}
          y={labelY}
          label={label as string}
          colorClass="bg-orange-900/80 text-orange-200 border-orange-500"
        />
      )}
    </>
  );
}
