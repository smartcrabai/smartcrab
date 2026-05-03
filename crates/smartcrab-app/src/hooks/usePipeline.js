import { useCallback } from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { useTauriCommand } from './useTauriCommand';
export function usePipeline() {
    const { pipelines, selectedPipeline, setPipelines, setSelectedPipeline } = usePipelineStore();
    const { isLoading: listLoading, error: listError, execute: fetchPipelinesCmd } = useTauriCommand('list_pipelines');
    const { isLoading: getLoading, error: getError, execute: fetchPipelineCmd } = useTauriCommand('get_pipeline');
    const fetchPipelines = useCallback(async () => {
        const result = await fetchPipelinesCmd();
        if (result)
            setPipelines(result);
    }, [fetchPipelinesCmd, setPipelines]);
    const selectPipeline = useCallback(async (id) => {
        const result = await fetchPipelineCmd({ id });
        if (result)
            setSelectedPipeline(result);
    }, [fetchPipelineCmd, setSelectedPipeline]);
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
