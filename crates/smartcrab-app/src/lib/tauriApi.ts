import { invoke } from '@tauri-apps/api/core';
import type {
  PipelineInfo,
  PipelineDetail,
  ExecutionSummary,
  ExecutionDetail,
  AdapterInfo,
  AdapterConfig,
  AdapterStatus,
  CronJob,
  SkillInfo,
} from '../types';

export const listPipelines = (): Promise<PipelineInfo[]> =>
  invoke('list_pipelines');

export const getPipeline = (id: string): Promise<PipelineDetail> =>
  invoke('get_pipeline', { id });

export const createPipeline = (name: string, yamlContent: string): Promise<PipelineInfo> =>
  invoke('create_pipeline', { name, yamlContent });

export const updatePipeline = (id: string, yamlContent: string): Promise<PipelineInfo> =>
  invoke('update_pipeline', { id, yamlContent });

export const deletePipeline = (id: string): Promise<void> =>
  invoke('delete_pipeline', { id });

export const togglePipeline = (id: string, isActive: boolean): Promise<PipelineInfo> =>
  invoke('toggle_pipeline', { id, isActive });

export const listExecutions = (pipelineId?: string): Promise<ExecutionSummary[]> =>
  invoke('list_executions', { pipelineId });

export const getExecution = (id: string): Promise<ExecutionDetail> =>
  invoke('get_execution', { id });

export const cancelExecution = (id: string): Promise<void> =>
  invoke('cancel_execution', { id });

export const listAdapters = (): Promise<AdapterInfo[]> =>
  invoke('list_adapters');

export const getAdapterStatus = (adapterType: string): Promise<AdapterStatus> =>
  invoke('get_adapter_status', { adapterType });

export const updateAdapterConfig = (config: AdapterConfig): Promise<void> =>
  invoke('update_adapter_config', { config });

export const listCronJobs = (): Promise<CronJob[]> =>
  invoke('list_cron_jobs');

export const listSkills = (): Promise<SkillInfo[]> =>
  invoke('list_skills');

export const invokeSkill = (skillId: string, input: unknown): Promise<unknown> =>
  invoke('invoke_skill', { skillId, input });
