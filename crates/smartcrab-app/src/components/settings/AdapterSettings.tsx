import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Square, ChevronDown, ChevronUp } from 'lucide-react';
import type { AdapterInfo, AdapterConfig } from '../../types';

export function AdapterSettings() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [configs, setConfigs] = useState<Record<string, AdapterConfig>>({});

  useEffect(() => {
    invoke<AdapterInfo[]>('list_adapters').then(setAdapters).catch(console.error);
  }, []);

  async function loadConfig(adapterType: string) {
    try {
      const cfg = await invoke<AdapterConfig>('get_adapter_config', { adapterType });
      setConfigs(prev => ({ ...prev, [adapterType]: cfg }));
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }

  async function saveConfig(adapterType: string, configJson: Record<string, unknown>) {
    try {
      await invoke('save_adapter_config', { adapterType, configJson });
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  }

  async function toggleAdapter(adapterType: string, isActive: boolean) {
    try {
      if (isActive) {
        await invoke('stop_adapter', { adapterType });
      } else {
        await invoke('start_adapter', { adapterType });
      }
      const updated = await invoke<AdapterInfo[]>('list_adapters');
      setAdapters(updated);
    } catch (e) {
      console.error('Failed to toggle adapter:', e);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Adapter Settings</h2>
      {adapters.map(adapter => (
        <AdapterCard
          key={adapter.adapterType}
          adapter={adapter}
          config={configs[adapter.adapterType]}
          onLoadConfig={() => loadConfig(adapter.adapterType)}
          onSaveConfig={configJson => saveConfig(adapter.adapterType, configJson)}
          onToggle={() => toggleAdapter(adapter.adapterType, adapter.isActive)}
        />
      ))}
      {adapters.length === 0 && (
        <p className="text-gray-400">No adapters found</p>
      )}
    </div>
  );
}

function AdapterCard({
  adapter,
  config,
  onLoadConfig,
  onSaveConfig,
  onToggle,
}: {
  adapter: AdapterInfo;
  config: AdapterConfig | undefined;
  onLoadConfig: () => void;
  onSaveConfig: (configJson: Record<string, unknown>) => void;
  onToggle: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});

  function handleExpand() {
    if (!isExpanded && !config) {
      onLoadConfig();
    }
    setIsExpanded(prev => !prev);
  }

  useEffect(() => {
    if (config) {
      setLocalConfig(config.configJson);
    }
  }, [config]);

  function handleFieldChange(key: string, value: string | number) {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    onSaveConfig(localConfig);
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-white font-medium">{adapter.name}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              adapter.isActive
                ? 'bg-green-900 text-green-300'
                : adapter.isConfigured
                ? 'bg-yellow-900 text-yellow-300'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {adapter.isActive ? 'Running' : adapter.isConfigured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium ${
              adapter.isActive
                ? 'bg-red-900 hover:bg-red-800 text-red-300'
                : 'bg-green-900 hover:bg-green-800 text-green-300'
            }`}
          >
            {adapter.isActive ? <Square size={14} /> : <Play size={14} />}
            {adapter.isActive ? 'Stop' : 'Start'}
          </button>
          <button
            onClick={handleExpand}
            className="p-1.5 text-gray-400 hover:text-white"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-700 pt-3 space-y-3">
          {adapter.adapterType === 'discord' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Bot Token Env Var Name</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={String(localConfig['bot_token_env'] ?? '')}
                  onChange={e => handleFieldChange('bot_token_env', e.target.value)}
                  placeholder="DISCORD_BOT_TOKEN"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Notification Channel ID</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={String(localConfig['notification_channel_id'] ?? '')}
                  onChange={e => handleFieldChange('notification_channel_id', e.target.value)}
                  placeholder="1234567890"
                />
              </div>
            </>
          )}
          {adapter.adapterType === 'claude' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Timeout (seconds)</label>
              <input
                type="number"
                className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={Number(localConfig['timeout_secs'] ?? 30)}
                onChange={e => handleFieldChange('timeout_secs', Number(e.target.value))}
                min={1}
                max={300}
              />
            </div>
          )}
          {adapter.adapterType !== 'discord' && adapter.adapterType !== 'claude' && (
            Object.entries(localConfig).map(([key, val]) => (
              <div key={key}>
                <label className="block text-sm text-gray-400 mb-1">{key}</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={String(val ?? '')}
                  onChange={e => handleFieldChange(key, e.target.value)}
                />
              </div>
            ))
          )}
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
