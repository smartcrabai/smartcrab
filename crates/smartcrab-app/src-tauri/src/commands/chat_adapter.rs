use serde::Serialize;
use tauri::State;

use crate::adapters::chat::runtime::ChatRuntimeState;
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

impl AdapterConfig {
    /// Returns `true` when the config JSON contains real values
    /// (not empty or just `{}`).
    #[must_use]
    pub fn is_configured(&self) -> bool {
        self.config_json != serde_json::json!({})
    }
}

/// Runtime status of an adapter.
#[derive(Debug, Clone, Serialize)]
pub struct AdapterStatus {
    pub adapter_type: String,
    pub is_running: bool,
}

/// List all registered chat adapters with their configuration status.
///
/// Overlays the in-process adapter registry with persisted DB config.
/// Adapters that have no DB row yet appear as unconfigured.
///
/// # Errors
///
/// Returns [`AppError`] if the database lock is poisoned or the query fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State must be passed by value"
)]
pub fn list_adapters(
    db: State<'_, DbState>,
    runtime: State<'_, ChatRuntimeState>,
) -> Result<Vec<AdapterInfo>, AppError> {
    let conn = db.lock()?;
    let registered = runtime.registered_adapters();
    let mut result = Vec::with_capacity(registered.len());

    for (id, name) in &registered {
        let db_row = get_adapter_config_db(&conn, id).ok();
        let (is_configured, is_active) = match &db_row {
            Some(cfg) => (cfg.is_configured(), cfg.is_active),
            None => (false, false),
        };
        result.push(AdapterInfo {
            adapter_type: id.clone(),
            name: name.clone(),
            is_configured,
            is_active,
        });
    }
    Ok(result)
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
/// Returns [`AppError`] if the database operation fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn save_adapter_config(
    db: State<'_, DbState>,
    adapter_type: String,
    config_json: serde_json::Value,
) -> Result<(), AppError> {
    let json_str = serde_json::to_string(&config_json)?;
    let conn = db.lock()?;
    update_adapter_config_db(&conn, &adapter_type, &json_str)
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
/// Returns [`AppError::NotFound`] if the adapter is not registered.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State must be passed by value"
)]
pub fn get_adapter_status(
    runtime: State<'_, ChatRuntimeState>,
    adapter_type: String,
) -> Result<AdapterStatus, AppError> {
    let status = runtime
        .get_status(&adapter_type)
        .ok_or_else(|| AppError::NotFound(format!("adapter '{adapter_type}' not registered")))?;
    Ok(AdapterStatus {
        adapter_type,
        is_running: status.is_running,
    })
}

// ---------------------------------------------------------------------------
// Standalone helpers (no Tauri State) used by tests
// ---------------------------------------------------------------------------

// Schema: chat_adapter_config (id TEXT PK, adapter_type TEXT NOT NULL,
//   config_json TEXT NOT NULL, is_active INTEGER, created_at TEXT, updated_at TEXT)
// We store adapter_type as the `id` so each adapter_type is unique and upsert
// works via the primary-key conflict clause.

#[cfg(test)]
pub(crate) fn list_adapters_db(conn: &rusqlite::Connection) -> Result<Vec<AdapterInfo>, AppError> {
    let mut stmt = conn.prepare("SELECT id, config_json, is_active FROM chat_adapter_config")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i32>(2)?,
        ))
    })?;
    let mut adapters = Vec::new();
    for row in rows {
        let (adapter_type, config_json_str, is_active_int) = row?;
        let config_json: serde_json::Value = serde_json::from_str(&config_json_str)?;
        let is_configured = AdapterConfig {
            adapter_type: adapter_type.clone(),
            config_json,
            is_active: false,
        }
        .is_configured();
        adapters.push(AdapterInfo {
            name: adapter_type.clone(),
            adapter_type,
            is_configured,
            is_active: is_active_int != 0,
        });
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
    use crate::default_chat_registry;

    // --- DB helpers ---

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

    // --- Registry-overlay list_adapters ---

    /// List adapters by overlaying registry entries with DB config.
    /// Returns one `AdapterInfo` per registered adapter.
    fn list_adapters_overlay_db(
        registry: &crate::adapters::AdapterRegistry<dyn crate::adapters::chat::ChatAdapter>,
        conn: &rusqlite::Connection,
    ) -> Vec<AdapterInfo> {
        let registered = registry.list();
        let mut result = Vec::with_capacity(registered.len());

        for (id, adapter) in &registered {
            let db_row = get_adapter_config_db(conn, id).ok();
            let (is_configured, is_active) = match &db_row {
                Some(cfg) => (cfg.is_configured(), cfg.is_active),
                None => (false, false),
            };
            result.push(AdapterInfo {
                adapter_type: id.clone(),
                name: adapter.name().to_owned(),
                is_configured,
                is_active,
            });
        }
        result
    }

    /// Get adapter config, returning a default if the adapter is registered
    /// but has no DB row yet.
    fn get_adapter_config_or_default_db(
        registry: &crate::adapters::AdapterRegistry<dyn crate::adapters::chat::ChatAdapter>,
        conn: &rusqlite::Connection,
        adapter_type: &str,
    ) -> Result<AdapterConfig, AppError> {
        let _adapter = registry
            .get(adapter_type)
            .ok_or_else(|| AppError::NotFound(format!("adapter '{adapter_type}' not found")))?;

        match get_adapter_config_db(conn, adapter_type) {
            Ok(cfg) => Ok(cfg),
            Err(AppError::NotFound(_)) => Ok(AdapterConfig {
                adapter_type: adapter_type.to_owned(),
                config_json: default_config_for_adapter(adapter_type),
                is_active: false,
            }),
            Err(e) => Err(e),
        }
    }

    fn default_config_for_adapter(adapter_type: &str) -> serde_json::Value {
        match adapter_type {
            "discord" => crate::adapters::chat::discord::DiscordConfig::default_config(),
            _ => serde_json::json!({}),
        }
    }

    /// Persist `is_active` flag to the DB.
    fn set_adapter_active_db(
        conn: &rusqlite::Connection,
        adapter_type: &str,
        is_active: bool,
    ) -> Result<(), AppError> {
        let active_int: i32 = i32::from(is_active);
        let rows = conn.execute(
            "UPDATE chat_adapter_config SET is_active = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![active_int, adapter_type],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!(
                "adapter '{adapter_type}' has no config row to activate"
            )));
        }
        Ok(())
    }

    #[test]
    fn list_adapters_overlay_includes_discord_even_when_db_empty() {
        // Given: registry with Discord but no DB rows
        let registry = default_chat_registry();
        let conn = test_db();

        // When: listing adapters with overlay
        let adapters = list_adapters_overlay_db(&registry, &conn);

        // Then: Discord appears in the list
        assert!(
            !adapters.is_empty(),
            "list should contain registered adapters"
        );
        let discord = adapters.iter().find(|a| a.adapter_type == "discord");
        assert!(discord.is_some(), "Discord should be in the list");
        let discord = discord.unwrap_or_else(|| panic!("checked above"));
        assert_eq!(discord.name, "Discord");
        assert!(
            !discord.is_configured,
            "should not be configured without DB row"
        );
        assert!(!discord.is_active, "should not be active without DB row");
    }

    #[test]
    fn list_adapters_overlay_merges_db_config() {
        // Given: registry with Discord and a DB row with config
        let registry = default_chat_registry();
        let conn = test_db();
        update_adapter_config_db(&conn, "discord", r#"{"bot_token_env":"MY_TOKEN"}"#)
            .unwrap_or_else(|e| panic!("insert should succeed: {e}"));

        // When: listing adapters with overlay
        let adapters = list_adapters_overlay_db(&registry, &conn);

        // Then: Discord is configured
        let discord = adapters.iter().find(|a| a.adapter_type == "discord");
        assert!(discord.is_some());
        let discord = discord.unwrap_or_else(|| panic!("checked above"));
        assert!(discord.is_configured, "should be configured with DB row");
    }

    #[test]
    fn get_adapter_config_or_default_returns_default_for_registered_adapter() {
        // Given: registry with Discord but no DB rows
        let registry = default_chat_registry();
        let conn = test_db();

        // When: getting config for Discord
        let result = get_adapter_config_or_default_db(&registry, &conn, "discord");

        // Then: returns a default config (not NotFound)
        assert!(result.is_ok(), "should return default config, not NotFound");
        let config = result.unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert_eq!(config.adapter_type, "discord");
        assert!(!config.is_active);
    }

    #[test]
    fn get_adapter_config_or_default_returns_saved_config() {
        // Given: registry with Discord and a saved config
        let registry = default_chat_registry();
        let conn = test_db();
        update_adapter_config_db(&conn, "discord", r#"{"bot_token_env":"MY_TOKEN"}"#)
            .unwrap_or_else(|e| panic!("insert should succeed: {e}"));

        // When: getting config for Discord
        let result = get_adapter_config_or_default_db(&registry, &conn, "discord");

        // Then: returns the saved config
        assert!(result.is_ok());
        let config = result.unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert_eq!(config.config_json["bot_token_env"], "MY_TOKEN");
    }

    #[test]
    fn get_adapter_config_or_default_returns_not_found_for_unregistered() {
        // Given: registry with Discord but querying for Slack
        let registry = default_chat_registry();
        let conn = test_db();

        // When: getting config for unregistered adapter
        let result = get_adapter_config_or_default_db(&registry, &conn, "slack");

        // Then: returns NotFound
        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be NotFound")
        };
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn set_adapter_active_persists_to_db() {
        // Given: a saved adapter config
        let conn = test_db();
        update_adapter_config_db(&conn, "discord", r#"{"bot_token_env":"T"}"#)
            .unwrap_or_else(|e| panic!("insert should succeed: {e}"));

        // When: setting adapter active
        set_adapter_active_db(&conn, "discord", true)
            .unwrap_or_else(|e| panic!("should succeed: {e}"));

        // Then: DB reflects is_active = true
        let config = get_adapter_config_db(&conn, "discord")
            .unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert!(config.is_active);
    }

    #[test]
    fn adapter_status_reflects_runtime_state() {
        // Given: a runtime state with Discord registered
        let runtime =
            crate::adapters::chat::runtime::ChatRuntimeState::new(default_chat_registry());

        // When: querying status
        let status = runtime.get_status("discord");

        // Then: Discord is registered but not running
        assert!(status.is_some());
        let status = status.unwrap_or_else(|| panic!("checked above"));
        assert!(!status.is_running);
    }
}
