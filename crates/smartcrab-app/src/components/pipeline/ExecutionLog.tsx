import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ExecutionDetail, ExecutionLog as ExecutionLogEntry } from "../../types";
import { EXECUTION_STATUS_STYLES, LOG_LEVEL_STYLES, formatDuration } from "./shared";

interface ExecutionLogProps {
  executionId: string;
}

export default function ExecutionLog({ executionId }: ExecutionLogProps) {
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [logs, setLogs] = useState<ExecutionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);
        setError(null);
        const result = await invoke<ExecutionDetail>("get_execution_detail", {
          id: executionId,
        });
        if (cancelled) return;
        setDetail(result);
        setLogs(result.logs);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    const unlistenPromise = listen<ExecutionLogEntry>("execution-event", (event) => {
      if (cancelled) return;
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
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading execution details...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 bg-red-900/30 border border-red-700 rounded-md text-red-400">
        {error ?? "Execution not found"}
      </div>
    );
  }

  const duration = formatDuration(detail.startedAt, detail.completedAt);

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              EXECUTION_STATUS_STYLES[detail.status] ?? "bg-gray-700 text-gray-400"
            }`}
          >
            {detail.status}
          </span>
          <span className="text-white font-semibold">{detail.pipelineName}</span>
          <span className="text-gray-400 text-sm">Trigger: {detail.triggerType}</span>
          <span className="text-gray-400 text-sm">
            Started: {new Date(detail.startedAt).toLocaleString()}
          </span>
          <span className="text-gray-400 text-sm">Duration: {duration}</span>
          {detail.errorMessage && (
            <span className="text-red-400 text-sm">{detail.errorMessage}</span>
          )}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-400 uppercase font-medium">
          Execution Logs
        </div>
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-500 text-xs">
                <th className="px-4 py-2 text-left whitespace-nowrap">Timestamp</th>
                <th className="px-4 py-2 text-left">Level</th>
                <th className="px-4 py-2 text-left">Node</th>
                <th className="px-4 py-2 text-left w-full">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No logs yet
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-gray-700/50 last:border-0 hover:bg-gray-750"
                  >
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap font-mono text-xs">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                          LOG_LEVEL_STYLES[log.level.toLowerCase()] ?? "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                      {log.nodeId ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-gray-300 font-mono text-xs">
                      {log.message}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
