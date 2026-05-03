import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EXECUTION_STATUS_STYLES, LOG_LEVEL_STYLES, formatDuration } from "./shared";
export default function ExecutionLog({ executionId }) {
    const [detail, setDetail] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const logsEndRef = useRef(null);
    useEffect(() => {
        let cancelled = false;
        async function init() {
            try {
                setLoading(true);
                setError(null);
                const result = await invoke("get_execution_detail", {
                    id: executionId,
                });
                if (cancelled)
                    return;
                setDetail(result);
                setLogs(result.logs);
            }
            catch (err) {
                if (!cancelled)
                    setError(String(err));
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        }
        init();
        const unlistenPromise = listen("execution-event", (event) => {
            if (cancelled)
                return;
            setLogs((prev) => [...prev, event.payload]);
            setTimeout(() => {
                logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 50);
        });
        return () => {
            cancelled = true;
            unlistenPromise.then((fn) => fn());
        };
    }, [executionId]);
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center h-full text-gray-400", children: "Loading execution details..." }));
    }
    if (error || !detail) {
        return (_jsx("div", { className: "p-4 bg-red-900/30 border border-red-700 rounded-md text-red-400", children: error ?? "Execution not found" }));
    }
    const duration = formatDuration(detail.startedAt, detail.completedAt);
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "bg-gray-800 rounded-lg border border-gray-700 p-4", children: _jsxs("div", { className: "flex flex-wrap gap-3 items-center", children: [_jsx("span", { className: `inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${EXECUTION_STATUS_STYLES[detail.status] ?? "bg-gray-700 text-gray-400"}`, children: detail.status }), _jsx("span", { className: "text-white font-semibold", children: detail.pipelineName }), _jsxs("span", { className: "text-gray-400 text-sm", children: ["Trigger: ", detail.triggerType] }), _jsxs("span", { className: "text-gray-400 text-sm", children: ["Started: ", new Date(detail.startedAt).toLocaleString()] }), _jsxs("span", { className: "text-gray-400 text-sm", children: ["Duration: ", duration] }), detail.errorMessage && (_jsx("span", { className: "text-red-400 text-sm", children: detail.errorMessage }))] }) }), _jsxs("div", { className: "bg-gray-800 rounded-lg border border-gray-700 overflow-hidden", children: [_jsx("div", { className: "px-4 py-2 border-b border-gray-700 text-xs text-gray-400 uppercase font-medium", children: "Execution Logs" }), _jsxs("div", { className: "overflow-auto max-h-[60vh]", children: [_jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-gray-700 text-gray-500 text-xs", children: [_jsx("th", { className: "px-4 py-2 text-left whitespace-nowrap", children: "Timestamp" }), _jsx("th", { className: "px-4 py-2 text-left", children: "Level" }), _jsx("th", { className: "px-4 py-2 text-left", children: "Node" }), _jsx("th", { className: "px-4 py-2 text-left w-full", children: "Message" })] }) }), _jsx("tbody", { children: logs.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 4, className: "px-4 py-8 text-center text-gray-500", children: "No logs yet" }) })) : (logs.map((log) => (_jsxs("tr", { className: "border-b border-gray-700/50 last:border-0 hover:bg-gray-750", children: [_jsx("td", { className: "px-4 py-2 text-gray-500 whitespace-nowrap font-mono text-xs", children: new Date(log.timestamp).toLocaleTimeString() }), _jsx("td", { className: "px-4 py-2", children: _jsx("span", { className: `inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${LOG_LEVEL_STYLES[log.level.toLowerCase()] ?? "bg-gray-700 text-gray-400"}`, children: log.level }) }), _jsx("td", { className: "px-4 py-2 text-gray-400 text-xs whitespace-nowrap", children: log.nodeId ?? "-" }), _jsx("td", { className: "px-4 py-2 text-gray-300 font-mono text-xs", children: log.message })] }, log.id)))) })] }), _jsx("div", { ref: logsEndRef })] })] })] }));
}
