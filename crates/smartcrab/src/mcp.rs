use std::collections::HashSet;

use serde_json::json;
use tracing::info;

use crate::dag::Dag;
use crate::error::{McpError, Result, SmartCrabError};

/// Transport protocol for the MCP server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportType {
    /// stdin/stdout JSON-RPC communication.
    Stdio,
    /// Server-Sent Events for remote communication.
    Sse { host: String, port: u16 },
}

/// A single MCP tool backed by a DAG.
pub struct McpTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
    dag: Dag,
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

    pub fn dag(&self) -> &Dag {
        &self.dag
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

/// Trait for converting a `Dag` into an `McpTool`.
pub trait DagToMcpTool {
    fn to_mcp_tool(&self) -> McpTool;
}

impl DagToMcpTool for Dag {
    fn to_mcp_tool(&self) -> McpTool {
        McpTool {
            name: self.name().to_string(),
            description: self.description().unwrap_or_default().to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
            }),
            dag: rebuild_dag_ref(self),
        }
    }
}

/// Rebuild a minimal placeholder DAG to store inside McpTool.
/// Since `Dag` cannot be cloned (contains closures), we store a reference-like
/// copy that preserves name and description only for metadata purposes.
/// The actual execution should reference the original `Dag`.
fn rebuild_dag_ref(dag: &Dag) -> Dag {
    // We need to build a minimal valid DAG. Since we can't clone layers/edges,
    // we create a stub that preserves name/description.
    use crate::dag::DagBuilder;
    use crate::layer::{InputLayer, Layer};

    struct StubInput;
    impl Layer for StubInput {
        fn name(&self) -> &str {
            "__mcp_stub__"
        }
    }
    #[async_trait::async_trait]
    impl InputLayer for StubInput {
        type Output = StubDto;
        async fn run(&self) -> Result<StubDto> {
            Ok(StubDto)
        }
    }

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    struct StubDto;

    let mut builder = DagBuilder::new(dag.name());
    if let Some(desc) = dag.description() {
        builder = builder.description(desc);
    }
    builder.add_input(StubInput).build().expect("failed to build stub DAG")
}

/// MCP server that exposes DAGs as tools.
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

    /// Add a DAG as an MCP tool (auto-converts via `DagToMcpTool`).
    pub fn add_dag_tool(mut self, dag: Dag) -> Self {
        let tool = dag.to_mcp_tool();
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
    use crate::dag::DagBuilder;
    use crate::error::McpError;
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
        type Output = TestMsg;
        async fn run(&self) -> Result<TestMsg> {
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

    fn build_test_dag(name: &str) -> Dag {
        DagBuilder::new(name)
            .description(format!("{name} description"))
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap()
    }

    // To build a second DAG with different layers (to avoid name conflicts)
    struct TestInput2;
    impl Layer for TestInput2 {
        fn name(&self) -> &str {
            "TestInput2"
        }
    }
    #[async_trait]
    impl InputLayer for TestInput2 {
        type Output = TestMsg;
        async fn run(&self) -> Result<TestMsg> {
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

    fn build_test_dag_2(name: &str) -> Dag {
        DagBuilder::new(name)
            .add_input(TestInput2)
            .add_output(TestOutput2)
            .add_edge("TestInput2", "TestOutput2")
            .build()
            .unwrap()
    }

    // --- DagToMcpTool tests ---

    #[test]
    fn test_dag_to_mcp_tool_name() {
        let dag = build_test_dag("analyze_code");
        let tool = dag.to_mcp_tool();
        assert_eq!(tool.name(), "analyze_code");
    }

    #[test]
    fn test_dag_to_mcp_tool_description() {
        let dag = build_test_dag("analyze_code");
        let tool = dag.to_mcp_tool();
        assert_eq!(tool.description(), "analyze_code description");
    }

    #[test]
    fn test_dag_to_mcp_tool_no_description() {
        let dag = DagBuilder::new("simple")
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap();
        let tool = dag.to_mcp_tool();
        assert_eq!(tool.description(), "");
    }

    #[test]
    fn test_dag_to_mcp_tool_input_schema() {
        let dag = build_test_dag("test");
        let tool = dag.to_mcp_tool();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"].is_object());
    }

    #[test]
    fn test_mcp_tool_to_json() {
        let dag = build_test_dag("my_tool");
        let tool = dag.to_mcp_tool();
        let json = tool.to_json();
        assert_eq!(json["name"], "my_tool");
        assert_eq!(json["description"], "my_tool description");
        assert!(json["inputSchema"].is_object());
    }

    // --- McpServerBuilder tests ---

    #[test]
    fn test_builder_basic() {
        let dag = build_test_dag("tool1");
        let server = McpServerBuilder::new("test-server")
            .add_dag_tool(dag)
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
        let dag = build_test_dag("tool1");
        let server = McpServerBuilder::new("my-server")
            .version("2.0.0")
            .description("My MCP Server")
            .transport(TransportType::Sse {
                host: "0.0.0.0".into(),
                port: 9090,
            })
            .add_dag_tool(dag)
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
        let dag1 = build_test_dag("tool1");
        let dag2 = build_test_dag_2("tool2");
        let server = McpServerBuilder::new("multi")
            .add_dag_tool(dag1)
            .add_dag_tool(dag2)
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
        let dag1 = build_test_dag("same_name");
        let dag2 = build_test_dag_2("same_name");
        let result = McpServerBuilder::new("dup")
            .add_dag_tool(dag1)
            .add_dag_tool(dag2)
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
        let dag = build_test_dag("t");
        let server = builder.add_dag_tool(dag).build().unwrap();
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
        let dag = build_test_dag("run_test");
        let server = McpServerBuilder::new("test-server")
            .add_dag_tool(dag)
            .build()
            .unwrap();

        let result = server.run().await;
        assert!(result.is_ok());
    }

    // --- Dag description tests ---

    #[test]
    fn test_dag_description() {
        let dag = DagBuilder::new("described")
            .description("A test DAG")
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap();

        assert_eq!(dag.description(), Some("A test DAG"));
    }

    #[test]
    fn test_dag_no_description() {
        let dag = DagBuilder::new("plain")
            .add_input(TestInput)
            .add_output(TestOutput)
            .add_edge("TestInput", "TestOutput")
            .build()
            .unwrap();

        assert_eq!(dag.description(), None);
    }
}
