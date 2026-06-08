//! `models` subcommand: list the models available for a provider.
//!
//! `seher-bridge models <provider> [--refresh]` emits exactly one terminal
//! frame: `models` (exit 0) or `models_error` (non-zero).
//!
//! Most providers go through pi's `fetch_provider_models`, which does a live
//! `GET /v1/models` (OpenAI-compatible) when a credential is present and
//! otherwise serves pi's bundled static registry.
//!
//! GitHub Copilot is special-cased: pi's generic `/v1/models` fetcher does not
//! speak Copilot's catalog endpoint (different path, required headers, and a
//! GitHub-token → session-token exchange), so for copilot pi always falls back
//! to its frozen static registry — which misses models added after the pinned
//! pi release. We instead hit Copilot's real endpoint directly
//! (`{endpoints.api}/models`) using the GitHub OAuth token from pi's auth.json,
//! and fall back to pi's static list only when not signed in or the live call
//! fails. The provider id is pi-canonical (`github-copilot`, `openai`, ...);
//! key-based providers receive their api key via env from the bun caller.

use std::io::{Stdout, stdout};

use pi::auth::{AuthCredential, AuthStorage};
use pi::config::Config;
use pi::http::client::Client;
use pi::provider_metadata::provider_auth_env_keys;
use serde::Deserialize;

use crate::io::FrameWriter;
use crate::protocol::ModelsEvent;

/// Copilot request headers — mirror pi's own values (overridable via the same
/// env vars pi honours) so the token exchange and catalog call are accepted.
const COPILOT_EDITOR_VERSION: &str = "vscode/1.96.2";
const COPILOT_USER_AGENT: &str = "GitHubCopilotChat/0.26.7";
const COPILOT_GITHUB_API_VERSION: &str = "2025-04-01";
const COPILOT_INTEGRATION_ID: &str = "vscode-chat";

/// Entry point for `seher-bridge models ...`. Returns the process exit code.
pub fn run_models(args: &[String]) -> i32 {
    let writer = FrameWriter::new(stdout());
    let Some(provider) = args.first() else {
        return emit_error(&writer, "usage: seher-bridge models <provider> [--refresh]");
    };
    // `--refresh` bypasses pi's model cache (used when the user explicitly
    // re-fetches); the default path serves a warm cache when present.
    let refresh = args[1..].iter().any(|a| a == "--refresh");

    let Some(rt) = runtime(&writer) else { return 1 };
    let api_key = resolve_provider_api_key(provider);

    let result = rt.block_on(fetch_models_for(provider, &api_key, refresh));

    match result {
        Ok(models) => {
            let frame = ModelsEvent::Models {
                provider: provider.clone(),
                models,
            };
            if let Err(e) = writer.write(&frame) {
                eprintln!("[seher-bridge] failed to write models frame: {e}");
                return 1;
            }
            0
        }
        Err(e) => emit_error(&writer, &e),
    }
}

/// Resolve the model list for `provider`. Copilot and custom OpenAI-compatible
/// endpoints are fetched directly (pi 0.1.18 can't list either); everything else
/// goes through pi. A direct fetch that fails or returns empty logs to stderr and
/// falls back to pi's list so the dropdown is never empty.
async fn fetch_models_for(
    provider: &str,
    api_key: &str,
    refresh: bool,
) -> Result<Vec<String>, String> {
    match provider {
        "github-copilot" | "copilot" => {
            if let Some(token) = copilot_github_token() {
                match fetch_copilot_models(&token).await {
                    Ok(ids) if !ids.is_empty() => return Ok(ids),
                    Ok(_) => eprintln!(
                        "[seher-bridge] copilot live model list was empty; using static registry"
                    ),
                    Err(e) => eprintln!(
                        "[seher-bridge] copilot live model fetch failed ({e}); using static registry"
                    ),
                }
            }
            // Static fallback only (no credential / live fetch failed).
            pi::providers::fetch_provider_models(provider, "")
                .await
                .map_err(|e| e.to_string())
        }
        // A custom OpenAI-compatible endpoint: pi only ever queries the canonical
        // api.openai.com, so honour the user's `OPENAI_BASE_URL` ourselves.
        "openai" if !openai_base_url().is_empty() => {
            let base = openai_base_url();
            match fetch_openai_compatible_models(&base, api_key).await {
                Ok(ids) if !ids.is_empty() => Ok(ids),
                Ok(_) => {
                    eprintln!(
                        "[seher-bridge] openai-compatible model list was empty at {base}; using static registry"
                    );
                    pi_models(provider, api_key, refresh).await
                }
                Err(e) => {
                    eprintln!(
                        "[seher-bridge] openai-compatible model fetch failed ({e}); using static registry"
                    );
                    pi_models(provider, api_key, refresh).await
                }
            }
        }
        _ => pi_models(provider, api_key, refresh).await,
    }
}

/// Delegate to pi's fetcher, honouring an explicit cache-bypassing refresh.
async fn pi_models(provider: &str, api_key: &str, refresh: bool) -> Result<Vec<String>, String> {
    let result = if refresh {
        pi::providers::refresh_provider_models(provider, api_key).await
    } else {
        pi::providers::fetch_provider_models(provider, api_key).await
    };
    result.map_err(|e| e.to_string())
}

/// The configured custom OpenAI base URL (empty when unset/blank → use pi).
fn openai_base_url() -> String {
    std::env::var("OPENAI_BASE_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_default()
}

/// Generic OpenAI-compatible catalog: `GET {base_url}/models`, parse `data[].id`.
async fn fetch_openai_compatible_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let base = base_url.trim().trim_end_matches('/');
    let client = Client::new();
    let mut request = client
        .get(&format!("{base}/models"))
        .header("Accept", "application/json");
    if !api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("model listing failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "/models returned HTTP {status}: {}",
            snippet(&body)
        ));
    }
    let parsed: OpenAiModelsResponse =
        serde_json::from_str(&body).map_err(|e| format!("invalid /models response: {e}"))?;
    let mut ids: Vec<String> = parsed
        .data
        .into_iter()
        .map(|m| m.id)
        .filter(|id| !id.trim().is_empty())
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelRow>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelRow {
    id: String,
}

/// The stored GitHub OAuth access token for Copilot, if signed in. pi keeps the
/// device-flow credential as `OAuth` in auth.json; its `access_token` is the
/// GitHub token we exchange for a short-lived Copilot session token.
fn copilot_github_token() -> Option<String> {
    let auth = AuthStorage::load(Config::auth_path()).ok()?;
    match auth.get("github-copilot")? {
        AuthCredential::OAuth { access_token, .. } if !access_token.trim().is_empty() => {
            Some(access_token.clone())
        }
        _ => None,
    }
}

/// Live Copilot model catalog: exchange the GitHub token for a session token,
/// then `GET {endpoints.api}/models`. Returns the chat-capable model ids.
async fn fetch_copilot_models(github_token: &str) -> Result<Vec<String>, String> {
    let client = Client::new();
    let editor_version = env_or("PI_COPILOT_EDITOR_VERSION", COPILOT_EDITOR_VERSION);
    let user_agent = env_or("PI_COPILOT_USER_AGENT", COPILOT_USER_AGENT);
    let api_version = env_or("PI_GITHUB_API_VERSION", COPILOT_GITHUB_API_VERSION);

    // Step 1: GitHub token -> Copilot session token + endpoints.
    let exchange = client
        .get("https://api.github.com/copilot_internal/v2/token")
        .header("Authorization", format!("token {github_token}"))
        .header("Accept", "application/json")
        .header("Editor-Version", editor_version.clone())
        .header("User-Agent", user_agent.clone())
        .header("X-Github-Api-Version", api_version.clone())
        .send()
        .await
        .map_err(|e| format!("copilot token exchange failed: {e}"))?;
    let status = exchange.status();
    let body = exchange.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "copilot token exchange returned HTTP {status}: {}",
            snippet(&body)
        ));
    }
    let token: CopilotTokenResponse =
        serde_json::from_str(&body).map_err(|e| format!("invalid copilot token response: {e}"))?;
    let api_base = if token.endpoints.api.trim().is_empty() {
        "https://api.githubcopilot.com".to_string()
    } else {
        token.endpoints.api.trim_end_matches('/').to_string()
    };

    // Step 2: list models from the Copilot catalog endpoint.
    let models_resp = client
        .get(&format!("{api_base}/models"))
        .header("Authorization", format!("Bearer {}", token.token))
        .header("Accept", "application/json")
        .header("Copilot-Integration-Id", COPILOT_INTEGRATION_ID)
        .header("Editor-Version", editor_version)
        .header("User-Agent", user_agent)
        .header("X-Github-Api-Version", api_version)
        .send()
        .await
        .map_err(|e| format!("copilot model listing failed: {e}"))?;
    let status = models_resp.status();
    let body = models_resp.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "copilot /models returned HTTP {status}: {}",
            snippet(&body)
        ));
    }
    let parsed: CopilotModelsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("invalid copilot /models response: {e}"))?;

    let mut ids: Vec<String> = parsed
        .data
        .into_iter()
        // Drop embeddings/non-chat entries; keep everything else (the chat models).
        .filter(|m| {
            m.capabilities
                .as_ref()
                .and_then(|c| c.kind.as_deref())
                .is_none_or(|t| t != "embeddings")
        })
        .map(|m| m.id)
        .filter(|id| !id.trim().is_empty())
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[derive(Debug, Deserialize)]
struct CopilotTokenResponse {
    token: String,
    #[serde(default)]
    endpoints: CopilotEndpoints,
}

#[derive(Debug, Default, Deserialize)]
struct CopilotEndpoints {
    #[serde(default)]
    api: String,
}

#[derive(Debug, Deserialize)]
struct CopilotModelsResponse {
    data: Vec<CopilotModelRow>,
}

#[derive(Debug, Deserialize)]
struct CopilotModelRow {
    id: String,
    #[serde(default)]
    capabilities: Option<CopilotCapabilities>,
}

#[derive(Debug, Deserialize)]
struct CopilotCapabilities {
    #[serde(default, rename = "type")]
    kind: Option<String>,
}

/// Resolve the API key for a provider: pi's auth.json credential first, then the
/// provider's advertised env vars. An empty string triggers pi's static-registry
/// path inside `fetch_provider_models`. Mirrors pi-cli's `resolve_provider_api_key`.
fn resolve_provider_api_key(provider: &str) -> String {
    if let Ok(auth) = AuthStorage::load(Config::auth_path())
        && let Some(key) = auth.api_key(provider)
        && !key.trim().is_empty()
    {
        return key;
    }
    for env_key in provider_auth_env_keys(provider) {
        if let Ok(value) = std::env::var(env_key)
            && !value.trim().is_empty()
        {
            return value;
        }
    }
    String::new()
}

/// First 200 chars of an error body, for diagnostics without dumping a page.
fn snippet(body: &str) -> String {
    body.chars().take(200).collect()
}

/// Env var override falling back to a default (matches pi's copilot header env).
fn env_or(var: &str, default: &str) -> String {
    std::env::var(var)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

/// Emit a terminal `models_error` frame; always returns exit code 1.
fn emit_error(writer: &FrameWriter<Stdout>, message: &str) -> i32 {
    let frame = ModelsEvent::ModelsError {
        message: message.to_string(),
    };
    if let Err(e) = writer.write(&frame) {
        eprintln!("[seher-bridge] failed to write models_error frame: {e}");
    }
    1
}

/// Current-thread tokio runtime (the model fetch is the only await).
fn runtime(writer: &FrameWriter<Stdout>) -> Option<tokio::runtime::Runtime> {
    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => Some(rt),
        Err(e) => {
            emit_error(writer, &format!("failed to build tokio runtime: {e}"));
            None
        }
    }
}
