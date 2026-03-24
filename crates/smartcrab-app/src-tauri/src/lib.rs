pub mod bridge;
pub mod commands;
pub mod error;

use commands::pipeline;

/// Creates and configures the Tauri application.
///
/// # Panics
///
/// Panics if the in-memory SQLite database cannot be opened, the schema
/// cannot be initialised, or the Tauri application fails to start. These
/// are all considered unrecoverable fatal startup failures.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used)]
pub fn run() {
    let conn = rusqlite::Connection::open_in_memory()
        .expect("Failed to open in-memory SQLite database");
    pipeline::init_db(&conn).expect("Failed to initialise database schema");

    tauri::Builder::default()
        .manage(std::sync::Mutex::new(conn))
        .invoke_handler(tauri::generate_handler![
            pipeline::list_pipelines,
            pipeline::get_pipeline,
            pipeline::create_pipeline,
            pipeline::update_pipeline,
            pipeline::delete_pipeline,
            pipeline::validate_pipeline,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
