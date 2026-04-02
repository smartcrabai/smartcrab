export interface ChatCapabilities {
  threads: boolean;
  reactions: boolean;
  fileUpload: boolean;
  streaming: boolean;
  directMessage: boolean;
  groupMessage: boolean;
}

export interface LlmCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  maxContextTokens: number;
}

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
