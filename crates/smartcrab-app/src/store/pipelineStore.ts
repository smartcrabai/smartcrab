import { create } from 'zustand';
import type { PipelineInfo, PipelineDetail } from '../types';

interface PipelineState {
  pipelines: PipelineInfo[];
  selectedPipeline: PipelineDetail | null;
  isLoading: boolean;
  error: string | null;
  setPipelines: (p: PipelineInfo[]) => void;
  setSelectedPipeline: (p: PipelineDetail | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const usePipelineStore = create<PipelineState>((set) => ({
  pipelines: [],
  selectedPipeline: null,
  isLoading: false,
  error: null,
  setPipelines: (pipelines) => set({ pipelines }),
  setSelectedPipeline: (selectedPipeline) => set({ selectedPipeline }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
