import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Pencil, Trash2 } from "lucide-react";
export default function PipelineList({ onEditPipeline, onNewPipeline, }) {
    const [pipelines, setPipelines] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        loadPipelines();
    }, []);
    async function loadPipelines() {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke("list_pipelines");
            setPipelines(result);
        }
        catch (err) {
            setError(String(err));
        }
        finally {
            setLoading(false);
        }
    }
    async function handleDelete(id, name) {
        if (!confirm(`Delete pipeline "${name}"? This cannot be undone.`))
            return;
        try {
            await invoke("delete_pipeline", { id });
            setPipelines((prev) => prev.filter((p) => p.id !== id));
        }
        catch (err) {
            setError(String(err));
        }
    }
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center h-full text-gray-400", children: "Loading pipelines..." }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("p", { className: "text-sm text-gray-400", children: [pipelines.length, " pipeline", pipelines.length !== 1 ? "s" : ""] }), _jsxs("button", { onClick: onNewPipeline, className: "inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors", children: [_jsx(Plus, { size: 16 }), "New Pipeline"] })] }), error && (_jsx("div", { className: "p-3 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm", children: error })), pipelines.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center justify-center py-20 text-gray-400", children: [_jsx("p", { className: "text-base", children: "No pipelines yet." }), _jsx("p", { className: "text-sm mt-1", children: "Create one with AI chat." })] })) : (_jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", children: pipelines.map((pipeline) => (_jsxs("div", { className: "bg-gray-800 rounded-lg p-4 hover:bg-gray-750 cursor-pointer transition-colors border border-gray-700", children: [_jsxs("div", { className: "flex items-start justify-between mb-2", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("h3", { className: "text-white font-semibold truncate", children: pipeline.name }), pipeline.description && (_jsx("p", { className: "text-gray-400 text-sm mt-1 line-clamp-2", children: pipeline.description }))] }), _jsx("span", { className: `ml-2 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${pipeline.isActive
                                        ? "bg-green-900/50 text-green-400"
                                        : "bg-gray-700 text-gray-400"}`, children: pipeline.isActive ? "Active" : "Inactive" })] }), _jsxs("div", { className: "flex items-center justify-between mt-3 pt-3 border-t border-gray-700", children: [_jsxs("span", { className: "text-xs text-gray-500", children: ["Updated", " ", new Date(pipeline.updatedAt).toLocaleDateString()] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: (e) => {
                                                e.stopPropagation();
                                                onEditPipeline(pipeline.id);
                                            }, className: "p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors", title: "Edit pipeline", children: _jsx(Pencil, { size: 14 }) }), _jsx("button", { onClick: (e) => {
                                                e.stopPropagation();
                                                handleDelete(pipeline.id, pipeline.name);
                                            }, className: "p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors", title: "Delete pipeline", children: _jsx(Trash2, { size: 14 }) })] })] })] }, pipeline.id))) }))] }));
}
