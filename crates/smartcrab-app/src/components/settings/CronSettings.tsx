import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, Trash2 } from 'lucide-react';
import type { CronJob, PipelineInfo } from '../../types';

function humanReadableCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return schedule;
  const [min, hour, dom, month, dow] = parts;

  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Every minute';
  }
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
  if (dom === '*' && month === '*' && dow === '*') {
    if (min !== '*' && hour !== '*') return `Daily at ${hour}:${min.padStart(2, '0')}`;
    if (min !== '*' && hour === '*') return `Every hour at minute ${min}`;
  }
  return schedule;
}

export function CronSettings() {
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newPipelineId, setNewPipelineId] = useState('');
  const [newSchedule, setNewSchedule] = useState('*/5 * * * *');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadJobs();
    invoke<PipelineInfo[]>('list_pipelines').then(setPipelines).catch(console.error);
  }, []);

  async function loadJobs() {
    try {
      const jobs = await invoke<CronJob[]>('list_cron_jobs');
      setCronJobs(jobs);
    } catch (e) {
      console.error('Failed to load cron jobs:', e);
    }
  }

  async function createJob() {
    if (!newPipelineId.trim() || !newSchedule.trim()) {
      setError('Please enter pipeline and schedule');
      return;
    }
    try {
      await invoke('create_cron_job', {
        pipelineId: newPipelineId,
        schedule: newSchedule,
      });
      setNewPipelineId('');
      setNewSchedule('*/5 * * * *');
      setShowForm(false);
      setError(null);
      await loadJobs();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteJob(id: string) {
    try {
      await invoke('delete_cron_job', { id });
      await loadJobs();
    } catch (e) {
      console.error('Failed to delete cron job:', e);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Schedule Settings</h2>
        <button
          onClick={() => setShowForm(prev => !prev)}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
        >
          <Plus size={14} />
          Add New
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Pipeline</label>
            {pipelines.length > 0 ? (
              <select
                className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newPipelineId}
                onChange={e => setNewPipelineId(e.target.value)}
              >
                <option value="">Please select</option>
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newPipelineId}
                onChange={e => setNewPipelineId(e.target.value)}
                placeholder="Pipeline ID"
              />
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Cron Expression</label>
            <input
              type="text"
              className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              value={newSchedule}
              onChange={e => setNewSchedule(e.target.value)}
              placeholder="*/5 * * * *"
            />
            <p className="text-xs text-gray-500 mt-1">
              Preview: {humanReadableCron(newSchedule)}
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={createJob}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium"
            >
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null); }}
              className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {cronJobs.length === 0 && !showForm && (
        <p className="text-gray-400">No schedules registered</p>
      )}

      {cronJobs.map(job => (
        <div key={job.id} className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-white font-medium text-sm font-mono">{job.schedule}</span>
                <span className="text-xs text-gray-400">({humanReadableCron(job.schedule)})</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    job.isActive ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {job.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-gray-400">Pipeline: {job.pipelineId}</p>
              {job.lastRunAt && (
                <p className="text-xs text-gray-500">
                  Last run: {new Date(job.lastRunAt).toLocaleString()}
                </p>
              )}
              {job.nextRunAt && (
                <p className="text-xs text-gray-500">
                  Next run: {new Date(job.nextRunAt).toLocaleString()}
                </p>
              )}
            </div>
            <button
              onClick={() => deleteJob(job.id)}
              className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
              title="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
