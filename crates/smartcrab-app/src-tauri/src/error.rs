use serde::Serialize;

/// Application-level errors for `SmartCrab` Tauri app.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Pipeline not found: {id}")]
    PipelineNotFound { id: String },

    #[error("Execution not found: {id}")]
    ExecutionNotFound { id: String },

    #[error("Execution failed: {message}")]
    ExecutionFailed { message: String },

    #[error("Internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_to_string() {
        let err = AppError::PipelineNotFound {
            id: "abc".to_owned(),
        };
        let json = serde_json::to_string(&err);
        assert!(json.is_ok());
        let json = json.ok();
        assert!(json.is_some_and(|j| j.contains("Pipeline not found: abc")));
    }

    #[test]
    fn app_error_display() {
        let err = AppError::ExecutionNotFound { id: "x".to_owned() };
        assert_eq!(err.to_string(), "Execution not found: x");
    }
}
