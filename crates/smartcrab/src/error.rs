use std::path::PathBuf;
use std::time::Duration;

/// Errors raised by storage operations.
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Storage I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Failed to serialize value for key `{key}`: {source}")]
    Serialization {
        key: String,
        source: serde_json::Error,
    },

    #[error("Failed to deserialize value for key `{key}`: {source}")]
    Deserialization {
        key: String,
        source: serde_json::Error,
    },

    #[error("Storage file corrupted at {path}: {source}")]
    FileCorrupted {
        path: PathBuf,
        source: serde_json::Error,
    },
}

/// Top-level error type for `SmartCrab`.
#[derive(Debug, thiserror::Error)]
pub enum SmartCrabError {
    #[error("Graph error: {0}")]
    Graph(#[from] GraphError),

    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),

    #[error("`claude` command not found. Is Claude Code CLI installed?")]
    ClaudeCodeNotFound,

    #[error("Claude Code timed out after {timeout:?}")]
    ClaudeCodeTimeout { timeout: Duration },

    #[error("Claude Code failed with exit code {exit_code}: {stderr}")]
    ClaudeCodeFailed { exit_code: i32, stderr: String },

    #[error("Failed to parse Claude Code response: {source}")]
    ResponseParseError {
        response: String,
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Telemetry initialization error: {0}")]
    Telemetry(String),

    #[error("{0}")]
    Other(String),

    #[error("Cron schedule error: {0}")]
    CronSchedule(String),

    #[error("Chat error ({platform}): {message}")]
    Chat { platform: String, message: String },

    #[error("MCP error: {0}")]
    Mcp(#[from] McpError),
}

/// MCP-specific errors raised during server construction.
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("No tools registered")]
    NoTools,

    #[error("Duplicate tool name: {name}")]
    DuplicateToolName { name: String },
}

/// Graph-specific errors raised during build or execution.
#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("Duplicate node name: {name}")]
    DuplicateNodeName { name: String },

    #[error("Unreachable node: {name}")]
    UnreachableNode { name: String },

    #[error("No input node found in graph")]
    NoInputNode,

    #[error(
        "Type mismatch on edge {from} -> {to}: output type `{output_type}` != input type `{input_type}`"
    )]
    TypeMismatch {
        from: String,
        to: String,
        output_type: String,
        input_type: String,
    },

    #[error("Missing branch target node: {target} (from condition on {from})")]
    MissingBranch { from: String, target: String },

    #[error("Invalid trigger configuration: {message}")]
    InvalidTriggerConfig { message: String },

    #[error("Node `{name}` failed: {source}")]
    NodeFailed {
        name: String,
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

pub type Result<T> = std::result::Result<T, SmartCrabError>;
