import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function Header({ title, discordActive = false }) {
    return (_jsxs("header", { className: "bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between shrink-0", children: [_jsx("h1", { className: "text-lg font-semibold text-white", children: title }), _jsxs("span", { className: `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${discordActive
                    ? "bg-green-900/50 text-green-400"
                    : "bg-gray-700 text-gray-400"}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${discordActive ? "bg-green-500" : "bg-gray-500"}` }), "Discord: ", discordActive ? "Active" : "Inactive"] })] }));
}
