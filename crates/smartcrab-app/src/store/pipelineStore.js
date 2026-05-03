import { create } from 'zustand';
export const usePipelineStore = create((set) => ({
    pipelines: [],
    selectedPipeline: null,
    isLoading: false,
    error: null,
    setPipelines: (pipelines) => set({ pipelines }),
    setSelectedPipeline: (selectedPipeline) => set({ selectedPipeline }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
}));
