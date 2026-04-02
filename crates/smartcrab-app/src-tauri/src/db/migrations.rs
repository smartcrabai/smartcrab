use rusqlite::Connection;

use crate::error::{AppError, Result};

struct Migration {
    version: u32,
    sql: &'static str,
}

/// Data migrations applied after the initial schema is created.
/// Add entries here (in ascending version order) for schema changes that
/// cannot be expressed as `ALTER TABLE ... IF NOT EXISTS`.
static MIGRATIONS: &[Migration] = &[];

/// Apply any pending migrations to the database.
///
/// Creates the `schema_migrations` tracking table on first run, then
/// executes each migration whose version has not yet been recorded.
///
/// # Errors
///
/// Returns [`crate::error::AppError`] if a migration SQL fails to execute.
pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )
    .map_err(AppError::Database)?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::Database)?;

    for migration in MIGRATIONS {
        if migration.version <= current_version {
            continue;
        }

        conn.execute_batch(migration.sql)
            .map_err(AppError::Database)?;

        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
            rusqlite::params![migration.version],
        )
        .map_err(AppError::Database)?;

        tracing::info!(version = migration.version, "Applied DB migration");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_successfully() -> Result<()> {
        let conn = Connection::open_in_memory().map_err(AppError::Database)?;
        run(&conn)?;
        // Must be idempotent.
        run(&conn)?;
        Ok(())
    }
}
