use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::AppError;

/// Thread-safe wrapper around a `rusqlite::Connection`.
///
/// Tauri state must be `Send + Sync`; `rusqlite::Connection` is `Send` but not
/// `Sync`, so we wrap it in a `Mutex`.
pub struct DbState {
    pub conn: Mutex<Connection>,
}

impl DbState {
    /// Open (or create) a `SQLite` database at `path` and run migrations.
    ///
    /// # Errors
    ///
    /// Returns [`AppError::Database`] if the connection cannot be opened or
    /// migrations fail.
    pub fn open(path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        let state = Self {
            conn: Mutex::new(conn),
        };
        state.migrate()?;
        Ok(state)
    }

    /// Create an in-memory database (useful for tests).
    ///
    /// # Errors
    ///
    /// Returns [`AppError::Database`] if migration fails.
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        let state = Self {
            conn: Mutex::new(conn),
        };
        state.migrate()?;
        Ok(state)
    }

    /// Acquire the mutex lock, mapping a poison error to [`AppError::Internal`].
    ///
    /// # Errors
    ///
    /// Returns [`AppError::Internal`] if the lock is poisoned.
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, AppError> {
        self.conn
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    fn migrate(&self) -> Result<(), AppError> {
        let conn = self.lock()?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS pipelines (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                yaml_definition TEXT NOT NULL,
                trigger_type TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS pipeline_executions (
                id TEXT PRIMARY KEY,
                pipeline_id TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                trigger_data TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT,
                error_message TEXT,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines(id)
            );

            CREATE TABLE IF NOT EXISTS node_executions (
                id TEXT PRIMARY KEY,
                execution_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                node_name TEXT NOT NULL,
                iteration INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'running',
                input_data TEXT,
                output_data TEXT,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT,
                error_message TEXT,
                FOREIGN KEY (execution_id) REFERENCES pipeline_executions(id)
            );

            CREATE TABLE IF NOT EXISTS execution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_id TEXT NOT NULL,
                node_id TEXT,
                level TEXT NOT NULL DEFAULT 'info',
                message TEXT NOT NULL,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (execution_id) REFERENCES pipeline_executions(id)
            );
            ",
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_succeeds() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
    }

    #[test]
    fn migration_creates_tables() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
        let db = db.ok();
        assert!(db.is_some());
        let db = db.as_ref();
        let conn = db.and_then(|d| d.conn.lock().ok());
        assert!(conn.is_some());
        let conn = conn.as_ref();

        // Verify tables exist by querying sqlite_master
        let count: i64 = conn
            .and_then(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('pipelines', 'pipeline_executions', 'node_executions', 'execution_logs')",
                    [],
                    |row| row.get(0),
                ).ok()
            })
            .unwrap_or(0);
        assert_eq!(count, 4);
    }
}
