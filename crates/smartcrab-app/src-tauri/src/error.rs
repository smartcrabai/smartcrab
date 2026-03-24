use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Engine error: {0}")]
    Engine(String),

    #[error("YAML parse error: {0}")]
    Yaml(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
