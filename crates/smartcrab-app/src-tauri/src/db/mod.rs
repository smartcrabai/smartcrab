pub mod migrations;
pub mod schema;

use rusqlite::Connection;
use std::sync::Mutex;

use crate::error::{AppError, Result};

/// Open (or create) the application `SQLite` database at `db_path`,
/// enable WAL mode for better concurrent read performance, and apply
/// all pending schema migrations.
///
/// # Errors
///
/// Returns [`AppError`] if the database cannot be opened or migrations fail.
pub fn init(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path).map_err(AppError::Database)?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(AppError::Database)?;

    for stmt in schema::ALL_TABLES {
        conn.execute_batch(stmt).map_err(AppError::Database)?;
    }

    migrations::run(&conn)?;

    tracing::info!(path = db_path, "Database initialised");

    Ok(conn)
}

/// Thread-safe wrapper around a `rusqlite::Connection` for use as Tauri managed state.
pub struct DbState {
    pub conn: Mutex<Connection>,
}

impl DbState {
    /// Create an in-memory database initialised with the application schema.
    ///
    /// # Errors
    ///
    /// Returns [`AppError`] if schema initialisation fails.
    pub fn open_in_memory() -> Result<Self> {
        let conn = init(":memory:")?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Acquire the database lock.
    ///
    /// # Errors
    ///
    /// Returns [`AppError::Other`] if the lock is poisoned.
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_db_initialises() -> Result<()> {
        let conn = init(":memory:")?;
        // Verify at least one expected table exists.
        let count: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='pipelines'",
                [],
                |row| row.get(0),
            )
            .map_err(AppError::Database)?;
        assert_eq!(count, 1);
        Ok(())
    }

    #[test]
    fn all_tables_created() -> Result<()> {
        let conn = init(":memory:")?;
        let expected_tables = [
            "pipelines",
            "pipeline_executions",
            "node_executions",
            "execution_logs",
            "skills",
            "chat_adapter_config",
            "llm_adapter_config",
            "cron_jobs",
        ];
        for table in expected_tables {
            let count: u32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table],
                    |row| row.get(0),
                )
                .map_err(AppError::Database)?;
            assert_eq!(count, 1, "Table '{table}' should exist");
        }
        Ok(())
    }
}
