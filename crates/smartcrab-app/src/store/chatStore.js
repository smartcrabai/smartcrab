import { create } from 'zustand';
export const useChatStore = create((set) => ({
    messages: [],
    isLoading: false,
    error: null,
    addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
    clearMessages: () => set({ messages: [] }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
}));
