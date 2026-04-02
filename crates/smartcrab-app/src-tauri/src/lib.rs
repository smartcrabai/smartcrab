#![deny(clippy::dbg_macro, clippy::expect_used, clippy::unwrap_used)]
#![warn(clippy::pedantic)]

pub mod adapters;
pub mod bridge;
pub mod commands;
pub mod db;
pub mod engine;
pub mod error;

use std::sync::Arc;

use tauri::Manager as _;

use crate::adapters::AdapterRegistry;
use crate::adapters::chat::ChatAdapter;
use crate::adapters::chat::discord::DiscordChatAdapter;
use crate::adapters::chat::runtime::ChatRuntimeState;
use crate::adapters::llm::LlmAdapter;
use crate::adapters::llm::claude::ClaudeLlmAdapter;
use crate::db::DbState;
use crate::error::{AppError, Result};

#[must_use]
pub fn default_chat_registry() -> AdapterRegistry<dyn ChatAdapter> {
    let mut registry: AdapterRegistry<dyn ChatAdapter> = AdapterRegistry::new();
    let adapter: Arc<dyn ChatAdapter> = Arc::new(DiscordChatAdapter::new());
    registry.register(
        crate::adapters::chat::discord::ADAPTER_ID.to_owned(),
        adapter,
    );
    registry
}

#[must_use]
pub fn default_llm_registry() -> AdapterRegistry<dyn LlmAdapter> {
    let mut registry: AdapterRegistry<dyn LlmAdapter> = AdapterRegistry::new();
    let adapter: Arc<dyn LlmAdapter> = Arc::new(ClaudeLlmAdapter::new());
    registry.register("claude".to_owned(), adapter);
    registry
}

/// Entry point called from `main.rs`.
///
/// # Errors
///
/// Returns [`AppError`] if the database cannot be initialised or the Tauri runtime fails.
pub fn run() -> Result<()> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
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
            let chat_runtime = ChatRuntimeState::new(default_chat_registry());
            app.manage(chat_runtime);
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
            commands::pipeline::toggle_pipeline,
            commands::chat_adapter::list_adapters,
            commands::chat_adapter::get_adapter_config,
            commands::chat_adapter::save_adapter_config,
            commands::chat_adapter::start_adapter,
            commands::chat_adapter::stop_adapter,
            commands::chat_adapter::get_adapter_status,
            commands::cron::list_cron_jobs,
            commands::cron::create_cron_job,
            commands::cron::update_cron_job,
            commands::cron::delete_cron_job,
            commands::execution::execute_pipeline,
            commands::execution::cancel_execution,
            commands::execution::get_execution_history,
            commands::execution::get_execution_detail,
            commands::skills::list_skills,
            commands::skills::generate_skill,
            commands::skills::delete_skill,
            commands::skills::invoke_skill,
            commands::chat_ai::chat_create_pipeline,
        ])
        .run(tauri::generate_context!())
        .map_err(AppError::Tauri)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::chat::{ChatAdapter, ChatCapabilities};
    use async_trait::async_trait;

    #[test]
    fn default_chat_registry_contains_discord() {
        let registry = default_chat_registry();
        assert!(registry.get("discord").is_some());
        assert_eq!(
            registry.get("discord").map(|a| a.id().to_owned()),
            Some("discord".to_owned())
        );
    }

    #[test]
    fn default_llm_registry_contains_claude() {
        let registry = default_llm_registry();
        assert!(registry.get("claude").is_some());
        assert_eq!(
            registry.get("claude").map(|a| a.id().to_owned()),
            Some("claude".to_owned())
        );
    }

    #[test]
    fn extensibility_new_adapter_via_trait_impl() {
        struct SlackAdapter;
        #[async_trait]
        impl ChatAdapter for SlackAdapter {
            fn id(&self) -> &'static str {
                "slack"
            }
            fn name(&self) -> &'static str {
                "Slack"
            }
            fn capabilities(&self) -> &ChatCapabilities {
                &ChatCapabilities {
                    threads: true,
                    reactions: true,
                    file_upload: true,
                    streaming: false,
                    direct_message: true,
                    group_message: true,
                }
            }
            async fn send_message(&self, _: &str, _: &str) -> crate::error::Result<()> {
                Ok(())
            }
            async fn start_listener(&self) -> crate::error::Result<()> {
                Ok(())
            }
            async fn stop_listener(&self) -> crate::error::Result<()> {
                Ok(())
            }
            fn is_running(&self) -> bool {
                false
            }
        }
        let mut registry = default_chat_registry();
        let slack_adapter: Arc<dyn ChatAdapter> = Arc::new(SlackAdapter);
        registry.register("slack".to_owned(), slack_adapter);
        assert_eq!(registry.list().len(), 2);
        assert!(registry.get("slack").is_some());
        assert!(registry.get("discord").is_some());
    }
}
