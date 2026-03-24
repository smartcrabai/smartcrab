import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { PipelineInfo } from "../../types";

interface PipelineListProps {
  onEditPipeline: (id: string) => void;
  onNewPipeline: () => void;
}

export default function PipelineList({
  onEditPipeline,
  onNewPipeline,
}: PipelineListProps) {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPipelines();
  }, []);

  async function loadPipelines() {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<PipelineInfo[]>("list_pipelines");
      setPipelines(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete pipeline "${name}"? This cannot be undone.`)) return;
    try {
      await invoke("delete_pipeline", { id });
      setPipelines((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading pipelines...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          {pipelines.length} pipeline{pipelines.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={onNewPipeline}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New Pipeline
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm">
          {error}
        </div>
      )}

      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <p className="text-base">No pipelines yet.</p>
          <p className="text-sm mt-1">Create one with AI chat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.id}
              className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 cursor-pointer transition-colors border border-gray-700"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold truncate">
                    {pipeline.name}
                  </h3>
                  {pipeline.description && (
                    <p className="text-gray-400 text-sm mt-1 line-clamp-2">
                      {pipeline.description}
                    </p>
                  )}
                </div>
                <span
                  className={`ml-2 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    pipeline.isActive
                      ? "bg-green-900/50 text-green-400"
                      : "bg-gray-700 text-gray-400"
                  }`}
                >
                  {pipeline.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
                <span className="text-xs text-gray-500">
                  Updated{" "}
                  {new Date(pipeline.updatedAt).toLocaleDateString()}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditPipeline(pipeline.id);
                    }}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    title="Edit pipeline"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(pipeline.id, pipeline.name);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                    title="Delete pipeline"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
