import { create } from 'zustand';

export type AppView = 'pipelines' | 'editor' | 'chat' | 'settings';

interface UiState {
  currentView: AppView;
  isSidebarOpen: boolean;
  setCurrentView: (view: AppView) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentView: 'pipelines',
  isSidebarOpen: true,
  setCurrentView: (currentView) => set({ currentView }),
  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));
