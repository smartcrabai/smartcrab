export type NodeType = 'input' | 'hidden' | 'output';

export interface AdapterInfo {
  adapterType: string;
  name: string;
  isConfigured: boolean;
  isActive: boolean;
}

export interface AdapterConfig {
  adapterType: string;
  configJson: Record<string, unknown>;
  isActive: boolean;
}

export interface AdapterStatus {
  adapterType: string;
  isRunning: boolean;
  connectedSince?: string;
}

export interface CronJob {
  id: string;
  pipelineId: string;
  schedule: string;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  skillType: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  yamlContent?: string;
  timestamp: string;
}

export interface PipelineInfo {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExecutionStatus = "running" | "completed" | "failed" | "cancelled";

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
  errorMessage?: string;
  nodeExecutions: NodeExecution[];
  logs: ExecutionLog[];
}

export interface NodeDefinition {
  id: string;
  name: string;
  action?: NodeAction;
  next?: string | string[];
  conditions?: Condition[];
}

export interface Condition {
  match: MatchCondition;
  next: string;
}

export type MatchCondition =
  | { type: 'regex'; pattern: string }
  | { type: 'status_code'; codes: number[] }
  | { type: 'json_path'; path: string; expected: unknown }
  | { type: 'exit_when'; pattern: string };

export type NodeAction =
  | { type: 'llm_call'; provider: string; prompt: string; timeout_secs: number }
  | { type: 'http_request'; method: string; url_template: string; headers?: Record<string, string>; body_template?: string }
  | { type: 'shell_command'; command_template: string; working_dir?: string; timeout_secs: number };

export interface PipelineDefinition {
  name: string;
  description?: string;
  version: string;
  trigger: { type: 'discord' | 'cron'; triggers?: string[]; schedule?: string };
  max_loop_count?: number;
  nodes: NodeDefinition[];
}
