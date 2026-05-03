import { create } from 'zustand';
export const useExecutionStore = create((set) => ({
    executions: [],
    selectedExecution: null,
    recentEvents: [],
    isLoading: false,
    error: null,
    setExecutions: (executions) => set({ executions }),
    setSelectedExecution: (selectedExecution) => set({ selectedExecution }),
    addEvent: (event) => set((state) => ({ recentEvents: [...state.recentEvents.slice(-99), event] })),
    clearEvents: () => set({ recentEvents: [] }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
}));
