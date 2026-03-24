import { useState } from "react";
import Layout from "./components/layout/Layout";
import PipelineList from "./components/pipeline/PipelineList";
import ExecutionHistory from "./components/pipeline/ExecutionHistory";
import ExecutionLog from "./components/pipeline/ExecutionLog";

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
      default:
        return (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p>Coming soon</p>
          </div>
        );
    }
  };

  return (
    <Layout
      currentView={currentView}
      onViewChange={handleViewChange}
      title={selectedExecutionId ? "Execution Log" : VIEW_TITLES[currentView]}
    >
      {renderContent()}
    </Layout>
  );
}

export default App;
