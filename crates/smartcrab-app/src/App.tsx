import { useState, useEffect } from "react";
import Layout from "./components/layout/Layout";
import PipelineList from "./components/pipeline/PipelineList";
import ExecutionHistory from "./components/pipeline/ExecutionHistory";
import ExecutionLog from "./components/pipeline/ExecutionLog";
import UpdateBanner from "./components/update/UpdateBanner";
import { AdapterSettings } from "./components/settings/AdapterSettings";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { invoke } from "@tauri-apps/api/core";

type View = "pipelines" | "executions" | "chat" | "settings";

const VIEW_TITLES: Record<View, string> = {
  pipelines: "Pipelines",
  executions: "Execution History",
  chat: "AI Chat",
  settings: "Settings",
};

function App() {
  const [currentView, setCurrentView] = useState<View>("pipelines");
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [discordActive, setDiscordActive] = useState(false);
  const { installAvailableUpdate, dismiss, checkForUpdates: _, ...bannerProps } = useAppUpdater();

  const refreshDiscordStatus = () => {
    invoke<{ is_running: boolean }>('get_adapter_status', { adapterType: 'discord' })
      .then(status => setDiscordActive(status.is_running))
      .catch((e) => console.error('get_adapter_status failed:', e));
  };

  useEffect(() => {
    refreshDiscordStatus();
  }, []);

  const handleViewChange = (view: string) => {
    setCurrentView(view as View);
    setSelectedExecutionId(null);
  };

  const renderContent = () => {
    if (selectedExecutionId) {
      return <ExecutionLog executionId={selectedExecutionId} />;
    }

    switch (currentView) {
      case "pipelines":
        return (
          <PipelineList
            onEditPipeline={() => {}}
            onNewPipeline={() => {}}
          />
        );
      case "executions":
        return (
          <ExecutionHistory
            onSelectExecution={(id) => setSelectedExecutionId(id)}
          />
        );
      case "settings":
        return <AdapterSettings onDiscordStatusChange={refreshDiscordStatus} />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p>Coming soon</p>
          </div>
        );
    }
  };

  return (
    <>
      <UpdateBanner
        {...bannerProps}
        onInstall={installAvailableUpdate}
        onDismiss={dismiss}
      />
      <Layout
        currentView={currentView}
        onViewChange={handleViewChange}
        title={selectedExecutionId ? "Execution Log" : VIEW_TITLES[currentView]}
        discordActive={discordActive}
      >
        {renderContent()}
      </Layout>
    </>
  );
}

export default App;
