import { create } from 'zustand';
export const useUiStore = create((set) => ({
    currentView: 'pipelines',
    isSidebarOpen: true,
    setCurrentView: (currentView) => set({ currentView }),
    setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
    toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));
