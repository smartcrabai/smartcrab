pub mod chat_adapter;
pub mod chat_ai;
pub mod cron;
pub mod skills;

use std::sync::Mutex;

use rusqlite::Connection;

/// Shared database state managed by Tauri.
pub struct DbState {
    pub db: Mutex<Connection>,
}

/// Initialize the database schema required by all command modules.
///
/// # Errors
///
/// Returns a `rusqlite::Error` if any DDL statement fails.
pub fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS chat_adapter_config (
            adapter_type TEXT PRIMARY KEY,
            name         TEXT NOT NULL DEFAULT '',
            config_json  TEXT NOT NULL DEFAULT '{}',
            is_active    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS cron_jobs (
            id          TEXT PRIMARY KEY,
            pipeline_id TEXT NOT NULL,
            schedule    TEXT NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            next_run_at TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pipelines (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            yaml        TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skills (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            file_path   TEXT NOT NULL,
            skill_type  TEXT NOT NULL DEFAULT 'pipeline',
            pipeline_id TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db for tests");
    init_db(&conn).expect("schema init for tests");
    conn
}
