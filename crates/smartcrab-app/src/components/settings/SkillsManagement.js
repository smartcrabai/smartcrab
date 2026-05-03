import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Wand2, Trash2, Eye, X } from 'lucide-react';
export function SkillsManagement() {
    const [skills, setSkills] = useState([]);
    const [pipelines, setPipelines] = useState([]);
    const [previewSkill, setPreviewSkill] = useState(null);
    const [generatingFor, setGeneratingFor] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        loadSkills();
        invoke('list_pipelines').then(setPipelines).catch(console.error);
    }, []);
    async function loadSkills() {
        try {
            const list = await invoke('list_skills');
            setSkills(list);
        }
        catch (e) {
            console.error('Failed to load skills:', e);
        }
    }
    async function generateSkill(pipelineId) {
        setGeneratingFor(pipelineId);
        setError(null);
        try {
            await invoke('generate_skill', { pipelineId });
            await loadSkills();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setGeneratingFor(null);
        }
    }
    async function deleteSkill(id) {
        try {
            await invoke('delete_skill', { id });
            await loadSkills();
        }
        catch (e) {
            console.error('Failed to delete skill:', e);
        }
    }
    async function previewSkillFile(skill) {
        try {
            const content = await invoke('read_skill_file', { id: skill.id });
            setPreviewSkill({ skill, content });
        }
        catch (e) {
            console.error('Failed to read skill file:', e);
        }
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("h2", { className: "text-xl font-semibold text-white", children: "\u30B9\u30AD\u30EB\u7BA1\u7406" }), error && (_jsx("div", { className: "bg-red-900/50 border border-red-700 rounded p-3 text-red-300 text-sm", children: error })), pipelines.length > 0 && (_jsxs("div", { className: "bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-2", children: [_jsx("p", { className: "text-sm text-gray-400 font-medium", children: "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u304B\u3089\u30B9\u30AD\u30EB\u3092\u751F\u6210" }), pipelines.map(pipeline => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-white text-sm", children: pipeline.name }), _jsxs("button", { onClick: () => generateSkill(pipeline.id), disabled: generatingFor === pipeline.id, className: "flex items-center gap-1 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs rounded font-medium", children: [_jsx(Wand2, { size: 13 }), generatingFor === pipeline.id ? '生成中...' : '生成'] })] }, pipeline.id)))] })), skills.length === 0 ? (_jsx("p", { className: "text-gray-400", children: "\u30B9\u30AD\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" })) : (_jsx("div", { className: "space-y-2", children: skills.map(skill => (_jsxs("div", { className: "bg-gray-800 rounded-lg border border-gray-700 px-4 py-3 flex items-start justify-between", children: [_jsxs("div", { className: "space-y-1 flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-white font-medium text-sm truncate", children: skill.name }), _jsx("span", { className: "text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded-full shrink-0", children: skill.skillType })] }), skill.description && (_jsx("p", { className: "text-xs text-gray-400 truncate", children: skill.description })), _jsx("p", { className: "text-xs text-gray-600 font-mono truncate", children: skill.filePath })] }), _jsxs("div", { className: "flex items-center gap-1 ml-3 shrink-0", children: [_jsx("button", { onClick: () => previewSkillFile(skill), className: "p-1.5 text-gray-400 hover:text-blue-400 transition-colors", title: "\u30D7\u30EC\u30D3\u30E5\u30FC", children: _jsx(Eye, { size: 15 }) }), _jsx("button", { onClick: () => deleteSkill(skill.id), className: "p-1.5 text-gray-400 hover:text-red-400 transition-colors", title: "\u524A\u9664", children: _jsx(Trash2, { size: 15 }) })] })] }, skill.id))) })), previewSkill && (_jsx("div", { className: "fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-gray-700", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-white font-semibold", children: previewSkill.skill.name }), _jsx("p", { className: "text-xs text-gray-500 font-mono", children: previewSkill.skill.filePath })] }), _jsx("button", { onClick: () => setPreviewSkill(null), className: "p-1 text-gray-400 hover:text-white", children: _jsx(X, { size: 18 }) })] }), _jsx("div", { className: "flex-1 overflow-auto p-4", children: _jsx("pre", { className: "text-sm text-gray-300 font-mono whitespace-pre-wrap", children: previewSkill.content }) })] }) }))] }));
}
