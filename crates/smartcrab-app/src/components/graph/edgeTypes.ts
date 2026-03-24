import type { EdgeTypes } from '@xyflow/react';
import { ConditionalEdge } from './ConditionalEdge';
import { LoopEdge } from './LoopEdge';

export const edgeTypes: EdgeTypes = {
  conditional: ConditionalEdge,
  loop: LoopEdge,
};
