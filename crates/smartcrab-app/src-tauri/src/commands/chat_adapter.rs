use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::AppError;

/// Summary info for a registered chat adapter.
#[derive(Debug, Clone, Serialize)]
pub struct AdapterInfo {
    pub adapter_type: String,
    pub name: String,
    pub is_configured: bool,
    pub is_active: bool,
}

/// Full configuration for a specific adapter.
#[derive(Debug, Clone, Serialize)]
pub struct AdapterConfig {
    pub adapter_type: String,
    pub config_json: serde_json::Value,
    pub is_active: bool,
}

/// Runtime status of an adapter.
#[derive(Debug, Clone, Serialize)]
pub struct AdapterStatus {
    pub adapter_type: String,
    pub is_running: bool,
    pub connected_since: Option<String>,
}

/// List all registered chat adapters with their configuration status.
///
/// # Errors
///
/// Returns [`AppError`] if the database lock is poisoned or the query fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State must be passed by value"
)]
pub fn list_adapters(db: State<'_, DbState>) -> Result<Vec<AdapterInfo>, AppError> {
    let conn = db.lock()?;
    list_adapters_db(&conn)
}

/// Get configuration for a specific adapter type.
///
/// # Errors
///
/// Returns [`AppError::NotFound`] if the adapter type is not registered, or
/// [`AppError`] for database or JSON parse failures.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn get_adapter_config(
    db: State<'_, DbState>,
    adapter_type: String,
) -> Result<AdapterConfig, AppError> {
    let conn = db.lock()?;
    get_adapter_config_db(&conn, &adapter_type)
}

/// Insert or update configuration for a chat adapter.
///
/// # Errors
///
/// Returns [`AppError`] if the JSON is invalid or the database operation fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn update_adapter_config(
    db: State<'_, DbState>,
    adapter_type: String,
    config_json: String,
) -> Result<(), AppError> {
    let _: serde_json::Value = serde_json::from_str(&config_json)?;
    let conn = db.lock()?;
    update_adapter_config_db(&conn, &adapter_type, &config_json)
}

/// Start a chat adapter (placeholder — actual adapter start logic is runtime-dependent).
///
/// # Errors
///
/// Reserved for future use; currently always returns `Ok(())`.
#[tauri::command]
pub async fn start_adapter(adapter_type: String) -> Result<(), AppError> {
    tracing::info!(adapter = %adapter_type, "start_adapter requested");
    // In a real implementation this would look up a running adapter manager
    // and call start on the relevant adapter. For now we acknowledge the request.
    Ok(())
}

/// Stop a chat adapter (placeholder).
///
/// # Errors
///
/// Reserved for future use; currently always returns `Ok(())`.
#[tauri::command]
pub async fn stop_adapter(adapter_type: String) -> Result<(), AppError> {
    tracing::info!(adapter = %adapter_type, "stop_adapter requested");
    Ok(())
}

/// Get the runtime status of a chat adapter.
///
/// # Errors
///
/// Reserved for future use; currently always returns `Ok(...)`.
#[tauri::command]
pub fn get_adapter_status(adapter_type: String) -> Result<AdapterStatus, AppError> {
    // Placeholder: real implementation would query an in-process adapter manager.
    Ok(AdapterStatus {
        adapter_type,
        is_running: false,
        connected_since: None,
    })
}

// ---------------------------------------------------------------------------
// Standalone helpers (no Tauri State) used by tests
// ---------------------------------------------------------------------------

// Schema: chat_adapter_config (id TEXT PK, adapter_type TEXT NOT NULL,
//   config_json TEXT NOT NULL, is_active INTEGER, created_at TEXT, updated_at TEXT)
// We store adapter_type as the `id` so each adapter_type is unique and upsert
// works via the primary-key conflict clause.

pub(crate) fn list_adapters_db(conn: &rusqlite::Connection) -> Result<Vec<AdapterInfo>, AppError> {
    let mut stmt = conn.prepare("SELECT id, config_json, is_active FROM chat_adapter_config")?;
    let rows = stmt.query_map([], |row| {
        let adapter_type: String = row.get(0)?;
        let config_json: String = row.get(1)?;
        let is_configured = config_json != "{}" && !config_json.is_empty();
        Ok(AdapterInfo {
            name: adapter_type.clone(),
            adapter_type,
            is_configured,
            is_active: row.get::<_, i32>(2)? != 0,
        })
    })?;
    let mut adapters = Vec::new();
    for row in rows {
        adapters.push(row?);
    }
    Ok(adapters)
}

pub(crate) fn get_adapter_config_db(
    conn: &rusqlite::Connection,
    adapter_type: &str,
) -> Result<AdapterConfig, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, config_json, is_active FROM chat_adapter_config WHERE id = ?1")?;
    let config = stmt
        .query_row([adapter_type], |row| {
            let json_str: String = row.get(1)?;
            Ok((row.get::<_, String>(0)?, json_str, row.get::<_, i32>(2)?))
        })
        .map_err(|_| AppError::NotFound(format!("adapter '{adapter_type}' not found")))?;
    let config_value: serde_json::Value = serde_json::from_str(&config.1)?;
    Ok(AdapterConfig {
        adapter_type: config.0,
        config_json: config_value,
        is_active: config.2 != 0,
    })
}

pub(crate) fn update_adapter_config_db(
    conn: &rusqlite::Connection,
    adapter_type: &str,
    config_json: &str,
) -> Result<(), AppError> {
    let _: serde_json::Value = serde_json::from_str(config_json)?;
    conn.execute(
        "INSERT INTO chat_adapter_config (id, adapter_type, config_json, is_active, created_at, updated_at)
         VALUES (?1, ?1, ?2, 0, datetime('now'), datetime('now'))
         ON CONFLICT(id)
         DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at",
        rusqlite::params![adapter_type, config_json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_db;

    #[test]
    fn list_adapters_empty() {
        let conn = test_db();
        let adapters = list_adapters_db(&conn).unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert!(adapters.is_empty());
    }

    #[test]
    fn adapter_config_crud() {
        let conn = test_db();

        // Insert
        let config = r#"{"token":"abc123"}"#;
        update_adapter_config_db(&conn, "discord", config)
            .unwrap_or_else(|e| panic!("insert should succeed: {e}"));

        // Read
        let result = get_adapter_config_db(&conn, "discord")
            .unwrap_or_else(|e| panic!("get should succeed: {e}"));
        assert_eq!(result.adapter_type, "discord");
        assert_eq!(result.config_json["token"], "abc123");
        assert!(!result.is_active);

        // List
        let list = list_adapters_db(&conn).unwrap_or_else(|e| panic!("list should succeed: {e}"));
        assert_eq!(list.len(), 1);
        assert!(list[0].is_configured);
        assert_eq!(list[0].adapter_type, "discord");

        // Update
        let config2 = r#"{"token":"def456","guild":"123"}"#;
        update_adapter_config_db(&conn, "discord", config2)
            .unwrap_or_else(|e| panic!("update should succeed: {e}"));
        let updated = get_adapter_config_db(&conn, "discord")
            .unwrap_or_else(|e| panic!("get should succeed: {e}"));
        assert_eq!(updated.config_json["token"], "def456");
        assert_eq!(updated.config_json["guild"], "123");
    }

    #[test]
    fn get_adapter_config_not_found() {
        let conn = test_db();
        let result = get_adapter_config_db(&conn, "nonexistent");
        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be NotFound")
        };
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn update_adapter_config_invalid_json() {
        let conn = test_db();
        let result = update_adapter_config_db(&conn, "discord", "not json");
        assert!(result.is_err());
    }

    #[test]
    fn adapter_not_configured_when_empty_json() {
        let conn = test_db();
        update_adapter_config_db(&conn, "slack", "{}")
            .unwrap_or_else(|e| panic!("insert should succeed: {e}"));
        let list = list_adapters_db(&conn).unwrap_or_else(|e| panic!("list should succeed: {e}"));
        assert_eq!(list.len(), 1);
        assert!(!list[0].is_configured);
    }

    #[test]
    fn adapter_status_default() {
        let status = get_adapter_status("discord".to_owned())
            .unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert_eq!(status.adapter_type, "discord");
        assert!(!status.is_running);
        assert!(status.connected_since.is_none());
    }

    #[test]
    fn adapter_info_serializes() {
        let info = AdapterInfo {
            adapter_type: "discord".to_owned(),
            name: "Discord".to_owned(),
            is_configured: true,
            is_active: false,
        };
        let json = serde_json::to_string(&info)
            .unwrap_or_else(|e| panic!("serialize should succeed: {e}"));
        assert!(json.contains("discord"));
        assert!(json.contains("is_configured"));
    }
}
