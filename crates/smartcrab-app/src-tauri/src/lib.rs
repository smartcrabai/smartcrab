#![deny(clippy::dbg_macro, clippy::expect_used, clippy::unwrap_used)]
#![warn(clippy::pedantic)]

pub mod bridge;
pub mod commands;
pub mod db;
pub mod engine;
pub mod error;

use tauri::Manager as _;

use crate::db::DbState;
use crate::error::{AppError, Result};

/// Entry point called from `main.rs`.
///
/// # Errors
///
/// Returns [`AppError`] if the database cannot be initialised or the Tauri runtime fails.
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
            let conn = db::init(db_path_str)?;
            app.manage(DbState {
                conn: std::sync::Mutex::new(conn),
            });
            tracing::info!("SmartCrab app started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pipeline::list_pipelines,
            commands::pipeline::get_pipeline,
            commands::pipeline::create_pipeline,
            commands::pipeline::update_pipeline,
            commands::pipeline::delete_pipeline,
            commands::pipeline::validate_pipeline,
            commands::execution::execute_pipeline,
            commands::execution::cancel_execution,
            commands::execution::get_execution_history,
            commands::execution::get_execution_detail,
        ])
        .run(tauri::generate_context!())
        .map_err(AppError::Tauri)?;
    Ok(())
}
