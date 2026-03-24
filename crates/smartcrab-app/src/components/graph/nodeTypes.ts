import type { NodeTypes } from '@xyflow/react';
import { InputLayerNode } from './InputLayerNode';
import { HiddenLayerNode } from './HiddenLayerNode';
import { OutputLayerNode } from './OutputLayerNode';

export const nodeTypes: NodeTypes = {
  input: InputLayerNode,
  hidden: HiddenLayerNode,
  output: OutputLayerNode,
};
