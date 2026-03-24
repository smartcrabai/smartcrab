import { useCallback } from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { useTauriCommand } from './useTauriCommand';
import type { PipelineInfo, PipelineDetail } from '../types';

export function usePipeline() {
  const { pipelines, selectedPipeline, setPipelines, setSelectedPipeline } = usePipelineStore();

  const { isLoading: listLoading, error: listError, execute: fetchPipelinesCmd } =
    useTauriCommand<PipelineInfo[]>('list_pipelines');
  const { isLoading: getLoading, error: getError, execute: fetchPipelineCmd } =
    useTauriCommand<PipelineDetail>('get_pipeline');

  const fetchPipelines = useCallback(async () => {
    const result = await fetchPipelinesCmd();
    if (result) setPipelines(result);
  }, [fetchPipelinesCmd, setPipelines]);

  const selectPipeline = useCallback(
    async (id: string) => {
      const result = await fetchPipelineCmd({ id } as Record<string, unknown>);
      if (result) setSelectedPipeline(result);
    },
    [fetchPipelineCmd, setSelectedPipeline],
  );

  const clearSelected = useCallback(() => {
    setSelectedPipeline(null);
  }, [setSelectedPipeline]);

  return {
    pipelines,
    selectedPipeline,
    isLoading: listLoading || getLoading,
    error: listError ?? getError,
    fetchPipelines,
    selectPipeline,
    clearSelected,
  };
}
