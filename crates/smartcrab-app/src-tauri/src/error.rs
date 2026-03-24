use serde::Serialize;

/// Application-level error type for the `SmartCrab` desktop app.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),
}

/// Tauri requires that command return errors implement `Serialize`.
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
    fn database_error_displays() {
        let err = AppError::Database(rusqlite::Error::QueryReturnedNoRows);
        assert!(err.to_string().contains("Database error"));
    }

    #[test]
    fn not_found_error_displays() {
        let err = AppError::NotFound("pipeline abc".to_owned());
        assert!(err.to_string().contains("pipeline abc"));
    }

    #[test]
    fn validation_error_displays() {
        let err = AppError::Validation("missing nodes".to_owned());
        assert!(err.to_string().contains("missing nodes"));
    }

    #[test]
    fn app_error_serializes_to_string() {
        let err = AppError::NotFound("test".to_owned());
        let json = serde_json::to_string(&err);
        assert!(json.is_ok());
        let json = json.unwrap_or_default();
        assert!(json.contains("Not found: test"));
    }
}
