import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, Trash2 } from 'lucide-react';
function humanReadableCron(schedule) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 5)
        return schedule;
    const [min, hour, dom, month, dow] = parts;
    if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
        return '毎分';
    }
    if (dom === '*' && month === '*' && dow === '*') {
        if (min !== '*' && hour !== '*')
            return `毎日 ${hour}:${min.padStart(2, '0')}`;
        if (min !== '*' && hour === '*')
            return `毎時 ${min} 分`;
    }
    if (min.startsWith('*/'))
        return `${min.slice(2)} 分ごと`;
    if (hour.startsWith('*/'))
        return `${hour.slice(2)} 時間ごと`;
    return schedule;
}
export function CronSettings() {
    const [cronJobs, setCronJobs] = useState([]);
    const [pipelines, setPipelines] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [newPipelineId, setNewPipelineId] = useState('');
    const [newSchedule, setNewSchedule] = useState('*/5 * * * *');
    const [error, setError] = useState(null);
    useEffect(() => {
        loadJobs();
        invoke('list_pipelines').then(setPipelines).catch(console.error);
    }, []);
    async function loadJobs() {
        try {
            const jobs = await invoke('list_cron_jobs');
            setCronJobs(jobs);
        }
        catch (e) {
            console.error('Failed to load cron jobs:', e);
        }
    }
    async function createJob() {
        if (!newPipelineId.trim() || !newSchedule.trim()) {
            setError('パイプラインとスケジュールを入力してください');
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
        }
        catch (e) {
            setError(String(e));
        }
    }
    async function deleteJob(id) {
        try {
            await invoke('delete_cron_job', { id });
            await loadJobs();
        }
        catch (e) {
            console.error('Failed to delete cron job:', e);
        }
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-xl font-semibold text-white", children: "\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB\u8A2D\u5B9A" }), _jsxs("button", { onClick: () => setShowForm(prev => !prev), className: "flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium", children: [_jsx(Plus, { size: 14 }), "\u65B0\u898F\u8FFD\u52A0"] })] }), showForm && (_jsxs("div", { className: "bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm text-gray-400 mb-1", children: "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3" }), pipelines.length > 0 ? (_jsxs("select", { className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", value: newPipelineId, onChange: e => setNewPipelineId(e.target.value), children: [_jsx("option", { value: "", children: "\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044" }), pipelines.map(p => (_jsx("option", { value: p.id, children: p.name }, p.id)))] })) : (_jsx("input", { type: "text", className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", value: newPipelineId, onChange: e => setNewPipelineId(e.target.value), placeholder: "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3 ID" }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm text-gray-400 mb-1", children: "Cron \u5F0F" }), _jsx("input", { type: "text", className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono", value: newSchedule, onChange: e => setNewSchedule(e.target.value), placeholder: "*/5 * * * *" }), _jsxs("p", { className: "text-xs text-gray-500 mt-1", children: ["\u30D7\u30EC\u30D3\u30E5\u30FC: ", humanReadableCron(newSchedule)] })] }), error && _jsx("p", { className: "text-sm text-red-400", children: error }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: createJob, className: "px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium", children: "\u4F5C\u6210" }), _jsx("button", { onClick: () => { setShowForm(false); setError(null); }, className: "px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded font-medium", children: "\u30AD\u30E3\u30F3\u30BB\u30EB" })] })] })), cronJobs.length === 0 && !showForm && (_jsx("p", { className: "text-gray-400", children: "\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB\u304C\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093" })), cronJobs.map(job => (_jsx("div", { className: "bg-gray-800 rounded-lg border border-gray-700 px-4 py-3", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-white font-medium text-sm font-mono", children: job.schedule }), _jsxs("span", { className: "text-xs text-gray-400", children: ["(", humanReadableCron(job.schedule), ")"] }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded-full ${job.isActive ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`, children: job.isActive ? '有効' : '無効' })] }), _jsxs("p", { className: "text-xs text-gray-400", children: ["\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3: ", job.pipelineId] }), job.lastRunAt && (_jsxs("p", { className: "text-xs text-gray-500", children: ["\u6700\u7D42\u5B9F\u884C: ", new Date(job.lastRunAt).toLocaleString('ja-JP')] })), job.nextRunAt && (_jsxs("p", { className: "text-xs text-gray-500", children: ["\u6B21\u56DE\u5B9F\u884C: ", new Date(job.nextRunAt).toLocaleString('ja-JP')] }))] }), _jsx("button", { onClick: () => deleteJob(job.id), className: "p-1.5 text-gray-500 hover:text-red-400 transition-colors", title: "\u524A\u9664", children: _jsx(Trash2, { size: 15 }) })] }) }, job.id)))] }));
}
