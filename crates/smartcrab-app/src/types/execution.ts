export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExecutionSummary {
  id: string;
  pipelineId: string;
  pipelineName: string;
  triggerType: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface NodeExecution {
  id: string;
  nodeId: string;
  nodeName: string;
  iteration: number;
  status: string;
  inputData?: unknown;
  outputData?: unknown;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface ExecutionLog {
  id: number;
  nodeId?: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface ExecutionDetail extends ExecutionSummary {
  triggerData?: unknown;
  errorMessage?: string;
  nodeExecutions: NodeExecution[];
  logs: ExecutionLog[];
}

export interface ExecutionEvent {
  executionId: string;
  eventType: string;
  nodeId?: string;
  nodeName?: string;
  data?: unknown;
  timestamp: string;
}
