pub mod db;
pub mod engine;
pub mod error;

use tauri::Manager as _;

use crate::error::{AppError, Result};

/// Entry point called from `main.rs`.
///
/// Initialises the database and starts the Tauri application.
///
/// # Errors
///
/// Returns [`AppError`] if the database cannot be initialised or the Tauri
/// runtime fails to start.
pub fn run() -> Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| AppError::Other(e.to_string()))?;

            std::fs::create_dir_all(&app_dir)?;

            let db_path = app_dir.join("smartcrab.db");
            let db_path_str = db_path
                .to_str()
                .ok_or_else(|| AppError::Other("DB path is not valid UTF-8".to_owned()))?;

            let _conn = db::init(db_path_str)?;

            tracing::info!("SmartCrab app started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(AppError::Tauri)?;

    Ok(())
}
