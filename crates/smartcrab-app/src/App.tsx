import { useUiStore, type AppView } from './store/uiStore';

const viewLabels: Record<AppView, string> = {
  pipelines: 'Pipelines',
  editor: 'Editor',
  chat: 'Chat',
  settings: 'Settings',
};

const views = Object.keys(viewLabels) as AppView[];

export default function App() {
  const { currentView, setCurrentView } = useUiStore();

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <nav className="w-48 bg-gray-900 border-r border-gray-800 flex flex-col p-4 gap-2">
        <h1 className="text-xl font-bold text-white mb-4">SmartCrab</h1>
        {views.map((view) => (
          <button
            key={view}
            onClick={() => setCurrentView(view)}
            className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
              currentView === view
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {viewLabels[view]}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <h2 className="text-2xl font-semibold mb-4">{viewLabels[currentView]}</h2>
        <p className="text-gray-400">View: {currentView}</p>
      </main>
    </div>
  );
}
