import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Square, ChevronDown, ChevronUp } from 'lucide-react';
export function AdapterSettings() {
    const [adapters, setAdapters] = useState([]);
    const [configs, setConfigs] = useState({});
    useEffect(() => {
        invoke('list_adapters').then(setAdapters).catch(console.error);
    }, []);
    async function loadConfig(adapterType) {
        try {
            const cfg = await invoke('get_adapter_config', { adapterType });
            setConfigs(prev => ({ ...prev, [adapterType]: cfg }));
        }
        catch (e) {
            console.error('Failed to load config:', e);
        }
    }
    async function saveConfig(adapterType, configJson) {
        try {
            await invoke('save_adapter_config', { adapterType, configJson });
        }
        catch (e) {
            console.error('Failed to save config:', e);
        }
    }
    async function toggleAdapter(adapterType, isActive) {
        try {
            if (isActive) {
                await invoke('stop_adapter', { adapterType });
            }
            else {
                await invoke('start_adapter', { adapterType });
            }
            const updated = await invoke('list_adapters');
            setAdapters(updated);
        }
        catch (e) {
            console.error('Failed to toggle adapter:', e);
        }
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("h2", { className: "text-xl font-semibold text-white", children: "\u30A2\u30C0\u30D7\u30BF\u30FC\u8A2D\u5B9A" }), adapters.map(adapter => (_jsx(AdapterCard, { adapter: adapter, config: configs[adapter.adapterType], onLoadConfig: () => loadConfig(adapter.adapterType), onSaveConfig: configJson => saveConfig(adapter.adapterType, configJson), onToggle: () => toggleAdapter(adapter.adapterType, adapter.isActive) }, adapter.adapterType))), adapters.length === 0 && (_jsx("p", { className: "text-gray-400", children: "\u30A2\u30C0\u30D7\u30BF\u30FC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }))] }));
}
function AdapterCard({ adapter, config, onLoadConfig, onSaveConfig, onToggle, }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [localConfig, setLocalConfig] = useState({});
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
    function handleFieldChange(key, value) {
        setLocalConfig(prev => ({ ...prev, [key]: value }));
    }
    function handleSave() {
        onSaveConfig(localConfig);
    }
    return (_jsxs("div", { className: "bg-gray-800 rounded-lg border border-gray-700", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-white font-medium", children: adapter.name }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded-full font-medium ${adapter.isActive
                                    ? 'bg-green-900 text-green-300'
                                    : adapter.isConfigured
                                        ? 'bg-yellow-900 text-yellow-300'
                                        : 'bg-gray-700 text-gray-400'}`, children: adapter.isActive ? '稼働中' : adapter.isConfigured ? '設定済み' : '未設定' })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: onToggle, className: `flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium ${adapter.isActive
                                    ? 'bg-red-900 hover:bg-red-800 text-red-300'
                                    : 'bg-green-900 hover:bg-green-800 text-green-300'}`, children: [adapter.isActive ? _jsx(Square, { size: 14 }) : _jsx(Play, { size: 14 }), adapter.isActive ? '停止' : '開始'] }), _jsx("button", { onClick: handleExpand, className: "p-1.5 text-gray-400 hover:text-white", children: isExpanded ? _jsx(ChevronUp, { size: 16 }) : _jsx(ChevronDown, { size: 16 }) })] })] }), isExpanded && (_jsxs("div", { className: "px-4 pb-4 border-t border-gray-700 pt-3 space-y-3", children: [adapter.adapterType === 'discord' && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm text-gray-400 mb-1", children: "Bot Token \u74B0\u5883\u5909\u6570\u540D" }), _jsx("input", { type: "text", className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", value: String(localConfig['bot_token_env'] ?? ''), onChange: e => handleFieldChange('bot_token_env', e.target.value), placeholder: "DISCORD_BOT_TOKEN" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm text-gray-400 mb-1", children: "\u901A\u77E5\u30C1\u30E3\u30F3\u30CD\u30EB ID" }), _jsx("input", { type: "text", className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", value: String(localConfig['notification_channel_id'] ?? ''), onChange: e => handleFieldChange('notification_channel_id', e.target.value), placeholder: "1234567890" })] })] })), adapter.adapterType === 'claude' && (_jsxs("div", { children: [_jsx("label", { className: "block text-sm text-gray-400 mb-1", children: "\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8 (\u79D2)" }), _jsx("input", { type: "number", className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", value: Number(localConfig['timeout_secs'] ?? 30), onChange: e => handleFieldChange('timeout_secs', Number(e.target.value)), min: 1, max: 300 })] })), adapter.adapterType !== 'discord' && adapter.adapterType !== 'claude' && (Object.entries(localConfig).map(([key, val]) => (_jsxs("div", { children: [_jsx("label", { className: "block text-sm text-gray-400 mb-1", children: key }), _jsx("input", { type: "text", className: "w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", value: String(val ?? ''), onChange: e => handleFieldChange(key, e.target.value) })] }, key)))), _jsx("button", { onClick: handleSave, className: "px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium", children: "\u4FDD\u5B58" })] }))] }));
}
