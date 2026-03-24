export type NodeType = 'input' | 'hidden' | 'output';

export interface PipelineInfo {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineDetail extends PipelineInfo {
  yamlContent: string;
  maxLoopCount: number;
}

export interface NodeDefinition {
  id: string;
  name: string;
  action?: NodeAction;
  next?: string | string[];
  conditions?: Condition[];
}

export interface ResolvedNode extends NodeDefinition {
  nodeType: NodeType;
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
  trigger: {
    type: 'discord' | 'cron';
    triggers?: string[];
    schedule?: string;
  };
  max_loop_count?: number;
  nodes: NodeDefinition[];
}

export interface ValidationResult {
  isValid: boolean;
  nodeTypes: Record<string, NodeType>;
  errors: string[];
  warnings: string[];
}
