import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Sidebar from "./Sidebar";
import Header from "./Header";
export default function Layout({ children, currentView, onViewChange, title, discordActive, }) {
    return (_jsxs("div", { className: "flex h-screen bg-gray-900 text-gray-100 overflow-hidden", children: [_jsx(Sidebar, { currentView: currentView, onViewChange: onViewChange }), _jsxs("div", { className: "flex-1 flex flex-col min-w-0", children: [_jsx(Header, { title: title, discordActive: discordActive }), _jsx("main", { className: "flex-1 overflow-auto p-4", children: children })] })] }));
}
