import type { ExecutionStatus } from "../../types";

export const EXECUTION_STATUS_STYLES: Record<ExecutionStatus, string> = {
  running: "bg-blue-900/50 text-blue-400 animate-pulse",
  completed: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
  cancelled: "bg-gray-700 text-gray-400",
};

export const LOG_LEVEL_STYLES: Record<string, string> = {
  info: "bg-blue-900/50 text-blue-400",
  warn: "bg-yellow-900/50 text-yellow-400",
  error: "bg-red-900/50 text-red-400",
  debug: "bg-gray-700 text-gray-400",
};

export function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
