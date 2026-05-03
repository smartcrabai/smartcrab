import { jsx as _jsx } from "react/jsx-runtime";
import { useState } from "react";
import Layout from "./components/layout/Layout";
import PipelineList from "./components/pipeline/PipelineList";
import ExecutionHistory from "./components/pipeline/ExecutionHistory";
import ExecutionLog from "./components/pipeline/ExecutionLog";
const VIEW_TITLES = {
    pipelines: "Pipelines",
    executions: "Execution History",
    chat: "AI Chat",
    settings: "Settings",
};
function App() {
    const [currentView, setCurrentView] = useState("pipelines");
    const [selectedExecutionId, setSelectedExecutionId] = useState(null);
    const handleViewChange = (view) => {
        setCurrentView(view);
        setSelectedExecutionId(null);
    };
    const renderContent = () => {
        if (selectedExecutionId) {
            return _jsx(ExecutionLog, { executionId: selectedExecutionId });
        }
        switch (currentView) {
            case "pipelines":
                return (_jsx(PipelineList, { onEditPipeline: () => { }, onNewPipeline: () => { } }));
            case "executions":
                return (_jsx(ExecutionHistory, { onSelectExecution: (id) => setSelectedExecutionId(id) }));
            default:
                return (_jsx("div", { className: "flex items-center justify-center h-full text-gray-400", children: _jsx("p", { children: "Coming soon" }) }));
        }
    };
    return (_jsx(Layout, { currentView: currentView, onViewChange: handleViewChange, title: selectedExecutionId ? "Execution Log" : VIEW_TITLES[currentView], children: renderContent() }));
}
export default App;
