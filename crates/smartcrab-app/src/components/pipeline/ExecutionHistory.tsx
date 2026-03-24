import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ExecutionSummary, ExecutionStatus } from "../../types";
import { EXECUTION_STATUS_STYLES, formatDuration } from "./shared";

interface ExecutionHistoryProps {
  onSelectExecution: (id: string) => void;
}

const STATUS_OPTIONS: ExecutionStatus[] = ["running", "completed", "failed", "cancelled"];

export default function ExecutionHistory({ onSelectExecution }: ExecutionHistoryProps) {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPipeline, setFilterPipeline] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<ExecutionSummary[]>("get_execution_history", {});
      setExecutions(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const pipelineNames = useMemo(
    () => [...new Set(executions.map((e) => e.pipelineName))],
    [executions],
  );

  const filtered = useMemo(
    () =>
      executions.filter((e) => {
        if (filterPipeline && e.pipelineName !== filterPipeline) return false;
        if (filterStatus && e.status !== filterStatus) return false;
        return true;
      }),
    [executions, filterPipeline, filterStatus],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading execution history...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <select
          value={filterPipeline}
          onChange={(e) => setFilterPipeline(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Pipelines</option>
          {pipelineNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
              <th className="px-4 py-3 text-left">Pipeline</th>
              <th className="px-4 py-3 text-left">Trigger</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Started</th>
              <th className="px-4 py-3 text-left">Duration</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No executions found
                </td>
              </tr>
            ) : (
              filtered.map((execution) => (
                <tr
                  key={execution.id}
                  onClick={() => onSelectExecution(execution.id)}
                  className="border-b border-gray-700 last:border-0 hover:bg-gray-750 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-white font-medium">
                    {execution.pipelineName}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{execution.triggerType}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${EXECUTION_STATUS_STYLES[execution.status]}`}
                    >
                      {execution.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(execution.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDuration(execution.startedAt, execution.completedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
