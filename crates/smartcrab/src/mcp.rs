use std::collections::HashSet;

use serde_json::json;
use tracing::info;

use crate::error::{McpError, Result, SmartCrabError};
use crate::graph::DirectedGraph;

/// Transport protocol for the MCP server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportType {
    /// stdin/stdout JSON-RPC communication.
    Stdio,
    /// Server-Sent Events for remote communication.
    Sse { host: String, port: u16 },
}

/// A single MCP tool backed by a DirectedGraph.
pub struct McpTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
    graph: DirectedGraph,
}

impl std::fmt::Debug for McpTool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpTool")
            .field("name", &self.name)
            .field("description", &self.description)
            .field("input_schema", &self.input_schema)
            .finish_non_exhaustive()
    }
}

impl McpTool {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn input_schema(&self) -> &serde_json::Value {
        &self.input_schema
    }

    pub fn graph(&self) -> &DirectedGraph {
        &self.graph
    }

    /// Serialize this tool as a JSON value for the MCP `tools/list` response.
    pub fn to_json(&self) -> serde_json::Value {
        json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
        })
    }
}

/// Trait for converting a `DirectedGraph` into an `McpTool`.
pub trait GraphToMcpTool {
    fn to_mcp_tool(&self) -> McpTool;
}

impl GraphToMcpTool for DirectedGraph {
    fn to_mcp_tool(&self) -> McpTool {
        McpTool {
            name: self.name().to_string(),
            description: self.description().unwrap_or_default().to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
            }),
            graph: rebuild_graph_ref(self),
        }
    }
}

/// Rebuild a minimal placeholder DirectedGraph to store inside McpTool.
/// Since `DirectedGraph` cannot be cloned (contains closures), the original graph is moved
/// into `to_mcp_tool`/`add_graph_tool` and dropped. This stub preserves only the name and
/// description for metadata purposes and is not intended for execution.
fn rebuild_graph_ref(graph: &DirectedGraph) -> DirectedGraph {
    // We need to build a minimal valid graph. Since we can't clone layers/edges,
    // we create a stub that preserves name/description.
    use crate::graph::DirectedGraphBuilder;
    use crate::layer::{InputLayer, Layer};

    struct StubInput;
    impl Layer for StubInput {
        fn name(&self) -> &str {
            "__mcp_stub__"
        }
    }
    #[async_trait::async_trait]
    impl InputLayer for StubInput {
        type TriggerData = ();
        type Output = StubDto;
        async fn run(&self, _: ()) -> Result<StubDto> {
            Ok(StubDto)
        }
    }

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    struct StubDto;

    let mut builder = DirectedGraphBuilder::new(graph.name());
    if let Some(desc) = graph.description() {
        builder = builder.description(desc);
    }
    builder.add_input(StubInput).build().expect("failed to build stub graph")
}

/// MCP server that exposes Graphs as tools.
pub struct McpServer {
    name: String,
    version: String,
    description: String,
    transport: TransportType,
    tools: Vec<McpTool>,
}

impl std::fmt::Debug for McpServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpServer")
            .field("name", &self.name)
            .field("version", &self.version)
            .field("description", &self.description)
            .field("transport", &self.transport)
            .field("tools_count", &self.tools.len())
            .finish()
    }
}

impl McpServer {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn transport(&self) -> &TransportType {
        &self.transport
    }

    pub fn tools(&self) -> &[McpTool] {
        &self.tools
    }

    /// Run the MCP server (placeholder for future protocol implementation).
    pub async fn run(&self) -> Result<()> {
        info!(
            name = %self.name,
            version = %self.version,
            transport = ?self.transport,
            tools = self.tools.len(),
            "MCP server starting"
        );
        // Protocol handling will be implemented later.
        // For now, just log startup info.
        Ok(())
    }
}

/// Builder for constructing an `McpServer`.
pub struct McpServerBuilder {
    name: String,
    version: String,
    description: String,
    transport: TransportType,
    tools: Vec<McpTool>,
}

impl McpServerBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            version: "1.0.0".to_owned(),
            description: String::new(),
            transport: TransportType::Stdio,
            tools: Vec::new(),
        }
    }

    pub fn version(mut self, version: impl Into<String>) -> Self {
        self.version = version.into();
        self
    }

    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }

    pub fn transport(mut self, transport: TransportType) -> Self {
        self.transport = transport;
        self
    }

    /// Add a DirectedGraph as an MCP tool (auto-converts via `GraphToMcpTool`).
    pub fn add_graph_tool(mut self, graph: DirectedGraph) -> Self {
        let tool = graph.to_mcp_tool();
        self.tools.push(tool);
        self
    }

    /// Validate and build the `McpServer`.
    pub fn build(self) -> Result<McpServer> {
        if self.tools.is_empty() {
            return Err(SmartCrabError::Mcp(McpError::NoTools));
        }

        let mut seen = HashSet::new();
        for tool in &self.tools {
            if !seen.insert(tool.name()) {
                return Err(SmartCrabError::Mcp(McpError::DuplicateToolName {
                    name: tool.name().to_string(),
                }));
            }
        }

        Ok(McpServer {
            name: self.name,
            version: self.version,
            description: self.description,
            transport: self.transport,
            tools: self.tools,
        })
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};

    use super::*;
    use crate::error::McpError;
    use crate::graph::DirectedGraphBuilder;
    use crate::layer::{InputLayer, Layer, OutputLayer};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct TestMsg {
        text: String,
    }

    struct TestInput;
    impl Layer for TestInput {
        fn name(&self) -> &str {
            "TestInput"
        }
    }
    #[async_trait]
    impl InputLayer for TestInput {
        type TriggerData = ();
        type Output = TestMsg;
        async fn run(&self, _: ()) -> Result<TestMsg> {
            Ok(TestMsg {
                text: "hello".into(),
            })
        }
    }

    struct TestOutput;
    impl Layer for TestOutput {
        fn name(&self) -> &str {
            "TestOutput"
        }
    }
    #[async_trait]
    impl OutputLayer for TestOutput {
        type Input = TestMsg;
        async fn run(&self, _input: TestMsg) -> Result<()> {
            Ok(())
        }
    }

    fn build_test_graph(name: &str) -> DirectedGraph {
        DirectedGraphBuilder::new(name)
            .description(format!("{name} description"))
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap()
    }

    // To build a second Graph with different layers (to avoid name conflicts)
    struct TestInput2;
    impl Layer for TestInput2 {
        fn name(&self) -> &str {
            "TestInput2"
        }
    }
    #[async_trait]
    impl InputLayer for TestInput2 {
        type TriggerData = ();
        type Output = TestMsg;
        async fn run(&self, _: ()) -> Result<TestMsg> {
            Ok(TestMsg {
                text: "hello2".into(),
            })
        }
    }

    struct TestOutput2;
    impl Layer for TestOutput2 {
        fn name(&self) -> &str {
            "TestOutput2"
        }
    }
    #[async_trait]
    impl OutputLayer for TestOutput2 {
        type Input = TestMsg;
        async fn run(&self, _input: TestMsg) -> Result<()> {
            Ok(())
        }
    }

    fn build_test_graph_2(name: &str) -> DirectedGraph {
        DirectedGraphBuilder::new(name)
            .add_input(TestInput2)
            .add_output(TestOutput2)
            .add_edge("TestInput2", "TestOutput2")
            .build()
            .unwrap()
    }

    // --- GraphToMcpTool tests ---

    #[test]
    fn test_graph_to_mcp_tool_name() {
        let graph = build_test_graph("analyze_code");
        let tool = graph.to_mcp_tool();
        assert_eq!(tool.name(), "analyze_code");
    }

    #[test]
    fn test_graph_to_mcp_tool_description() {
        let graph = build_test_graph("analyze_code");
        let tool = graph.to_mcp_tool();
        assert_eq!(tool.description(), "analyze_code description");
    }

    #[test]
    fn test_graph_to_mcp_tool_no_description() {
        let graph = DirectedGraphBuilder::new("simple")
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap();
        let tool = graph.to_mcp_tool();
        assert_eq!(tool.description(), "");
    }

    #[test]
    fn test_graph_to_mcp_tool_input_schema() {
        let graph = build_test_graph("test");
        let tool = graph.to_mcp_tool();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"].is_object());
    }

    #[test]
    fn test_mcp_tool_to_json() {
        let graph = build_test_graph("my_tool");
        let tool = graph.to_mcp_tool();
        let json = tool.to_json();
        assert_eq!(json["name"], "my_tool");
        assert_eq!(json["description"], "my_tool description");
        assert!(json["inputSchema"].is_object());
    }

    // --- McpServerBuilder tests ---

    #[test]
    fn test_builder_basic() {
        let graph = build_test_graph("tool1");
        let server = McpServerBuilder::new("test-server")
            .add_graph_tool(graph)
            .build()
            .unwrap();

        assert_eq!(server.name(), "test-server");
        assert_eq!(server.version(), "1.0.0");
        assert_eq!(server.description(), "");
        assert_eq!(server.transport(), &TransportType::Stdio);
        assert_eq!(server.tools().len(), 1);
        assert_eq!(server.tools()[0].name(), "tool1");
    }

    #[test]
    fn test_builder_with_all_options() {
        let graph = build_test_graph("tool1");
        let server = McpServerBuilder::new("my-server")
            .version("2.0.0")
            .description("My MCP Server")
            .transport(TransportType::Sse {
                host: "0.0.0.0".into(),
                port: 9090,
            })
            .add_graph_tool(graph)
            .build()
            .unwrap();

        assert_eq!(server.name(), "my-server");
        assert_eq!(server.version(), "2.0.0");
        assert_eq!(server.description(), "My MCP Server");
        assert_eq!(
            server.transport(),
            &TransportType::Sse {
                host: "0.0.0.0".into(),
                port: 9090,
            }
        );
    }

    #[test]
    fn test_builder_multiple_tools() {
        let graph1 = build_test_graph("tool1");
        let graph2 = build_test_graph_2("tool2");
        let server = McpServerBuilder::new("multi")
            .add_graph_tool(graph1)
            .add_graph_tool(graph2)
            .build()
            .unwrap();

        assert_eq!(server.tools().len(), 2);
    }

    #[test]
    fn test_builder_no_tools_error() {
        let result = McpServerBuilder::new("empty").build();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, SmartCrabError::Mcp(McpError::NoTools)));
    }

    #[test]
    fn test_builder_duplicate_tool_name_error() {
        let graph1 = build_test_graph("same_name");
        let graph2 = build_test_graph_2("same_name");
        let result = McpServerBuilder::new("dup")
            .add_graph_tool(graph1)
            .add_graph_tool(graph2)
            .build();

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(
            err,
            SmartCrabError::Mcp(McpError::DuplicateToolName { .. })
        ));
    }

    // --- TransportType tests ---

    #[test]
    fn test_transport_type_stdio_default() {
        let builder = McpServerBuilder::new("test");
        let graph = build_test_graph("t");
        let server = builder.add_graph_tool(graph).build().unwrap();
        assert_eq!(server.transport(), &TransportType::Stdio);
    }

    #[test]
    fn test_transport_type_sse() {
        let transport = TransportType::Sse {
            host: "127.0.0.1".into(),
            port: 8080,
        };
        assert_eq!(
            transport,
            TransportType::Sse {
                host: "127.0.0.1".into(),
                port: 8080,
            }
        );
    }

    #[test]
    fn test_transport_type_debug() {
        let stdio = TransportType::Stdio;
        assert!(format!("{:?}", stdio).contains("Stdio"));

        let sse = TransportType::Sse {
            host: "localhost".into(),
            port: 3000,
        };
        let debug = format!("{:?}", sse);
        assert!(debug.contains("Sse"));
        assert!(debug.contains("localhost"));
        assert!(debug.contains("3000"));
    }

    // --- McpServer run test ---

    #[tokio::test]
    async fn test_server_run() {
        let graph = build_test_graph("run_test");
        let server = McpServerBuilder::new("test-server")
            .add_graph_tool(graph)
            .build()
            .unwrap();

        let result = server.run().await;
        assert!(result.is_ok());
    }

    // --- DirectedGraph description tests ---

    #[test]
    fn test_graph_description() {
        let graph = DirectedGraphBuilder::new("described")
            .description("A test graph")
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap();

        assert_eq!(graph.description(), Some("A test graph"));
    }

    #[test]
    fn test_graph_no_description() {
        let graph = DirectedGraphBuilder::new("plain")
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap();

        assert_eq!(graph.description(), None);
    }
}
