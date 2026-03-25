import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Wand2, Trash2, Eye, X } from 'lucide-react';
import type { SkillInfo, PipelineInfo } from '../../types';

export function SkillsManagement() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [previewSkill, setPreviewSkill] = useState<{ skill: SkillInfo; content: string } | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
    invoke<PipelineInfo[]>('list_pipelines').then(setPipelines).catch(console.error);
  }, []);

  async function loadSkills() {
    try {
      const list = await invoke<SkillInfo[]>('list_skills');
      setSkills(list);
    } catch (e) {
      console.error('Failed to load skills:', e);
    }
  }

  async function generateSkill(pipelineId: string) {
    setGeneratingFor(pipelineId);
    setError(null);
    try {
      await invoke('generate_skill', { pipelineId });
      await loadSkills();
    } catch (e) {
      setError(String(e));
    } finally {
      setGeneratingFor(null);
    }
  }

  async function deleteSkill(id: string) {
    try {
      await invoke('delete_skill', { id });
      await loadSkills();
    } catch (e) {
      console.error('Failed to delete skill:', e);
    }
  }

  async function previewSkillFile(skill: SkillInfo) {
    try {
      const content = await invoke<string>('read_skill_file', { id: skill.id });
      setPreviewSkill({ skill, content });
    } catch (e) {
      console.error('Failed to read skill file:', e);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Skill Management</h2>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {pipelines.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-2">
          <p className="text-sm text-gray-400 font-medium">Generate skills from pipeline</p>
          {pipelines.map(pipeline => (
            <div key={pipeline.id} className="flex items-center justify-between">
              <span className="text-white text-sm">{pipeline.name}</span>
              <button
                onClick={() => generateSkill(pipeline.id)}
                disabled={generatingFor === pipeline.id}
                className="flex items-center gap-1 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs rounded font-medium"
              >
                <Wand2 size={13} />
                {generatingFor === pipeline.id ? 'Generating...' : 'Generate'}
              </button>
            </div>
          ))}
        </div>
      )}

      {skills.length === 0 ? (
        <p className="text-gray-400">No skills found</p>
      ) : (
        <div className="space-y-2">
          {skills.map(skill => (
            <div
              key={skill.id}
              className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-3 flex items-start justify-between"
            >
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium text-sm truncate">{skill.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded-full shrink-0">
                    {skill.skillType}
                  </span>
                </div>
                {skill.description && (
                  <p className="text-xs text-gray-400 truncate">{skill.description}</p>
                )}
                <p className="text-xs text-gray-600 font-mono truncate">{skill.filePath}</p>
              </div>
              <div className="flex items-center gap-1 ml-3 shrink-0">
                <button
                  onClick={() => previewSkillFile(skill)}
                  className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors"
                  title="Preview"
                >
                  <Eye size={15} />
                </button>
                <button
                  onClick={() => deleteSkill(skill.id)}
                  className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewSkill && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div>
                <h3 className="text-white font-semibold">{previewSkill.skill.name}</h3>
                <p className="text-xs text-gray-500 font-mono">{previewSkill.skill.filePath}</p>
              </div>
              <button
                onClick={() => setPreviewSkill(null)}
                className="p-1 text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">
                {previewSkill.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
