use std::time::Duration;

/// Top-level error type for SmartCrab.
#[derive(Debug, thiserror::Error)]
pub enum SmartCrabError {
    #[error("DAG error: {0}")]
    Dag(#[from] DagError),

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
}

/// DAG-specific errors raised during build or execution.
#[derive(Debug, thiserror::Error)]
pub enum DagError {
    #[error("Cycle detected in DAG")]
    CycleDetected,

    #[error("Duplicate node name: {name}")]
    DuplicateNodeName { name: String },

    #[error("Unreachable node: {name}")]
    UnreachableNode { name: String },

    #[error("No input node found in DAG")]
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

    #[error("Layer `{name}` failed: {source}")]
    LayerFailed {
        name: String,
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

pub type Result<T> = std::result::Result<T, SmartCrabError>;
