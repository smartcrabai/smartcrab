use serde::Serialize;

/// Application-level error type for Tauri commands.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Adapter error: {0}")]
    Adapter(String),

    #[error("Claude CLI error: {0}")]
    ClaudeCli(String),
}

/// Serializable wrapper so Tauri can return errors to the frontend.
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
        let err = AppError::NotFound("pipeline xyz".to_owned());
        let json = serde_json::to_string(&err);
        assert!(json.is_ok());
        let s = json.expect("serialization should succeed in test");
        assert!(s.contains("Not found: pipeline xyz"));
    }

    #[test]
    fn app_error_display() {
        let err = AppError::InvalidInput("bad cron".to_owned());
        assert_eq!(err.to_string(), "Invalid input: bad cron");
    }
}
