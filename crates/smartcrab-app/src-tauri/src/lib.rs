#![deny(clippy::dbg_macro, clippy::expect_used, clippy::unwrap_used)]
#![warn(clippy::pedantic)]

pub mod commands;
pub mod error;

use rusqlite::Connection;
use tauri::Manager;

use commands::{DbState, init_db};

/// Set up and run the Tauri application.
///
/// # Errors
///
/// Returns a `tauri::Error` if the application fails to build or run.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("smartcrab.db");
            let conn =
                Connection::open(&db_path).map_err(|e| std::io::Error::other(e.to_string()))?;
            init_db(&conn).map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(DbState {
                db: std::sync::Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::chat_adapter::list_adapters,
            commands::chat_adapter::get_adapter_config,
            commands::chat_adapter::update_adapter_config,
            commands::chat_adapter::start_adapter,
            commands::chat_adapter::stop_adapter,
            commands::chat_adapter::get_adapter_status,
            commands::cron::list_cron_jobs,
            commands::cron::create_cron_job,
            commands::cron::update_cron_job,
            commands::cron::delete_cron_job,
            commands::skills::list_skills,
            commands::skills::generate_skill,
            commands::skills::delete_skill,
            commands::chat_ai::chat_create_pipeline,
        ])
        .run(tauri::generate_context!())
}
