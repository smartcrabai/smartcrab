import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EXECUTION_STATUS_STYLES, formatDuration } from "./shared";
const STATUS_OPTIONS = ["running", "completed", "failed", "cancelled"];
export default function ExecutionHistory({ onSelectExecution }) {
    const [executions, setExecutions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filterPipeline, setFilterPipeline] = useState("");
    const [filterStatus, setFilterStatus] = useState("");
    useEffect(() => {
        loadHistory();
    }, []);
    async function loadHistory() {
        try {
            setLoading(true);
            setError(null);
            const result = await invoke("get_execution_history", {});
            setExecutions(result);
        }
        catch (err) {
            setError(String(err));
        }
        finally {
            setLoading(false);
        }
    }
    const pipelineNames = useMemo(() => [...new Set(executions.map((e) => e.pipelineName))], [executions]);
    const filtered = useMemo(() => executions.filter((e) => {
        if (filterPipeline && e.pipelineName !== filterPipeline)
            return false;
        if (filterStatus && e.status !== filterStatus)
            return false;
        return true;
    }), [executions, filterPipeline, filterStatus]);
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center h-full text-gray-400", children: "Loading execution history..." }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3 items-center", children: [_jsxs("select", { value: filterPipeline, onChange: (e) => setFilterPipeline(e.target.value), className: "bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500", children: [_jsx("option", { value: "", children: "All Pipelines" }), pipelineNames.map((name) => (_jsx("option", { value: name, children: name }, name)))] }), _jsxs("select", { value: filterStatus, onChange: (e) => setFilterStatus(e.target.value), className: "bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500", children: [_jsx("option", { value: "", children: "All Statuses" }), STATUS_OPTIONS.map((s) => (_jsx("option", { value: s, children: s }, s)))] }), _jsxs("span", { className: "text-sm text-gray-500 ml-auto", children: [filtered.length, " result", filtered.length !== 1 ? "s" : ""] })] }), error && (_jsx("div", { className: "p-3 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm", children: error })), _jsx("div", { className: "bg-gray-800 rounded-lg border border-gray-700 overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-gray-700 text-gray-400 text-xs uppercase", children: [_jsx("th", { className: "px-4 py-3 text-left", children: "Pipeline" }), _jsx("th", { className: "px-4 py-3 text-left", children: "Trigger" }), _jsx("th", { className: "px-4 py-3 text-left", children: "Status" }), _jsx("th", { className: "px-4 py-3 text-left", children: "Started" }), _jsx("th", { className: "px-4 py-3 text-left", children: "Duration" })] }) }), _jsx("tbody", { children: filtered.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, className: "px-4 py-8 text-center text-gray-500", children: "No executions found" }) })) : (filtered.map((execution) => (_jsxs("tr", { onClick: () => onSelectExecution(execution.id), className: "border-b border-gray-700 last:border-0 hover:bg-gray-750 cursor-pointer transition-colors", children: [_jsx("td", { className: "px-4 py-3 text-white font-medium", children: execution.pipelineName }), _jsx("td", { className: "px-4 py-3 text-gray-400", children: execution.triggerType }), _jsx("td", { className: "px-4 py-3", children: _jsx("span", { className: `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${EXECUTION_STATUS_STYLES[execution.status]}`, children: execution.status }) }), _jsx("td", { className: "px-4 py-3 text-gray-400", children: new Date(execution.startedAt).toLocaleString() }), _jsx("td", { className: "px-4 py-3 text-gray-400", children: formatDuration(execution.startedAt, execution.completedAt) })] }, execution.id)))) })] }) })] }));
}
