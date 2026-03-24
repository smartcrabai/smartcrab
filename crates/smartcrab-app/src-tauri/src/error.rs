use serde::Serialize;

/// Application-level error type for the `SmartCrab` desktop app.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("Engine error: {0}")]
    Engine(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Adapter error: {0}")]
    Adapter(String),

    #[error("Claude CLI error: {0}")]
    ClaudeCli(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
