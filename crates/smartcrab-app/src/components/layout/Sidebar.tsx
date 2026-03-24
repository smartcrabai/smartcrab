import { GitBranch, Network, MessageSquare, Settings } from "lucide-react";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

const navItems: NavItem[] = [
  { id: "pipelines", label: "Pipelines", icon: <GitBranch size={18} /> },
  { id: "executions", label: "Executions", icon: <Network size={18} /> },
  { id: "chat", label: "AI Chat", icon: <MessageSquare size={18} /> },
  { id: "settings", label: "Settings", icon: <Settings size={18} /> },
];

export default function Sidebar({ currentView, onViewChange }: SidebarProps) {
  return (
    <aside className="bg-gray-800 h-full flex flex-col w-64 shrink-0">
      <div className="px-4 py-4 border-b border-gray-700">
        <h1 className="text-lg font-bold text-white">SmartCrab 🦀</h1>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              currentView === item.id
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
