import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GitBranch, Network, MessageSquare, Settings } from "lucide-react";
const navItems = [
    { id: "pipelines", label: "Pipelines", icon: _jsx(GitBranch, { size: 18 }) },
    { id: "executions", label: "Executions", icon: _jsx(Network, { size: 18 }) },
    { id: "chat", label: "AI Chat", icon: _jsx(MessageSquare, { size: 18 }) },
    { id: "settings", label: "Settings", icon: _jsx(Settings, { size: 18 }) },
];
export default function Sidebar({ currentView, onViewChange }) {
    return (_jsxs("aside", { className: "bg-gray-800 h-full flex flex-col w-64 shrink-0", children: [_jsx("div", { className: "px-4 py-4 border-b border-gray-700", children: _jsx("h1", { className: "text-lg font-bold text-white", children: "SmartCrab \uD83E\uDD80" }) }), _jsx("nav", { className: "flex-1 px-2 py-3 space-y-1", children: navItems.map((item) => (_jsxs("button", { onClick: () => onViewChange(item.id), className: `w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === item.id
                        ? "bg-blue-600 text-white"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white"}`, children: [item.icon, item.label] }, item.id))) })] }));
}
