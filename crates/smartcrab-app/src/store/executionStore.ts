import { create } from 'zustand';
import type { ExecutionSummary, ExecutionDetail, ExecutionEvent } from '../types';

interface ExecutionState {
  executions: ExecutionSummary[];
  selectedExecution: ExecutionDetail | null;
  recentEvents: ExecutionEvent[];
  isLoading: boolean;
  error: string | null;
  setExecutions: (e: ExecutionSummary[]) => void;
  setSelectedExecution: (e: ExecutionDetail | null) => void;
  addEvent: (event: ExecutionEvent) => void;
  clearEvents: () => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  executions: [],
  selectedExecution: null,
  recentEvents: [],
  isLoading: false,
  error: null,
  setExecutions: (executions) => set({ executions }),
  setSelectedExecution: (selectedExecution) => set({ selectedExecution }),
  addEvent: (event) =>
    set((state) => ({ recentEvents: [...state.recentEvents.slice(-99), event] })),
  clearEvents: () => set({ recentEvents: [] }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
