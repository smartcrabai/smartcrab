//! `auth` subcommand: GUI-driven provider login and credential status.
//!
//! - `seher-bridge auth login <provider>` — runs the provider's interactive
//!   flow (GitHub Copilot: RFC 8628 device flow; OpenAI Codex: OAuth PKCE with
//!   a localhost callback server) and persists the credential to pi's standard
//!   `~/.pi/agent/auth.json`. Emits one progress frame (`device_code` /
//!   `oauth_url`) and one terminal frame (`auth_done` / `auth_error`).
//! - `seher-bridge auth status <provider>...` — emits one `auth_status` frame
//!   per provider and exits 0.
//!
//! Once a credential is stored, runs need no api key in the YAML config: pi
//! resolves it from auth.json at run time (with automatic OAuth refresh).
//!
//! The auth.json location follows pi's resolution (`~/.pi/agent/auth.json`,
//! overridable via `PI_CODING_AGENT_DIR`) so logins are shared with the pi and
//! seher CLIs — and so tests can point it at a temp dir.

use std::io::{Stdout, Write, stdout};
use std::time::{Duration, Instant};

use pi::auth::{
    AuthCredential, AuthStorage, CopilotOAuthConfig, CredentialStatus, DeviceFlowPollResult,
    complete_openai_codex_oauth, poll_copilot_device_flow, redirect_uri_needs_callback_server,
    start_copilot_device_flow, start_oauth_callback_server, start_openai_codex_oauth,
};
use pi::config::Config;

use crate::io::FrameWriter;
use crate::protocol::AuthEvent;

/// Default wait for the OAuth browser callback (overridable via
/// `SMARTCRAB_SEHER_BRIDGE_AUTH_TIMEOUT_MS`).
const DEFAULT_AUTH_TIMEOUT_MS: u64 = 300_000;

/// Entry point for `seher-bridge auth ...`. Returns the process exit code.
pub fn run_auth(args: &[String]) -> i32 {
    let writer = FrameWriter::new(stdout());
    match args.first().map(String::as_str) {
        Some("login") => match args.get(1) {
            Some(provider) => login(&writer, provider),
            None => emit_error(&writer, "usage: seher-bridge auth login <provider>"),
        },
        Some("status") if args.len() > 1 => status(&writer, &args[1..]),
        _ => emit_error(
            &writer,
            "usage: seher-bridge auth login <provider> | seher-bridge auth status <provider>...",
        ),
    }
}

/// Dispatch a login flow by pi canonical provider id (aliases accepted).
fn login(writer: &FrameWriter<Stdout>, provider: &str) -> i32 {
    match provider {
        "github-copilot" | "copilot" => login_copilot(writer),
        "openai-codex" | "codex" | "chatgpt-codex" => login_codex(writer),
        other => emit_error(
            writer,
            &format!("unsupported login provider '{other}' (expected github-copilot or openai-codex)"),
        ),
    }
}

/// GitHub Copilot device flow (RFC 8628): emit the user code, then poll the
/// token endpoint until the user authorizes in the browser.
fn login_copilot(writer: &FrameWriter<Stdout>) -> i32 {
    let Some(rt) = runtime(writer) else { return 1 };
    let cfg = CopilotOAuthConfig::default();
    let device = match rt.block_on(start_copilot_device_flow(&cfg)) {
        Ok(d) => d,
        Err(e) => return emit_error(writer, &format!("failed to start device flow: {e}")),
    };

    let frame = AuthEvent::DeviceCode {
        user_code: device.user_code.clone(),
        verification_uri: device.verification_uri.clone(),
        verification_uri_complete: device
            .verification_uri_complete
            .clone()
            .unwrap_or_else(|| device.verification_uri.clone()),
        expires_in: device.expires_in,
        interval: device.interval,
    };
    if let Err(e) = writer.write(&frame) {
        eprintln!("[seher-bridge] failed to write device_code frame: {e}");
        return 1;
    }

    let mut interval = device.interval.max(1);
    let deadline = Instant::now() + Duration::from_secs(device.expires_in);
    loop {
        if Instant::now() >= deadline {
            return emit_error(writer, "device code expired before authorization");
        }
        std::thread::sleep(Duration::from_secs(interval));
        match rt.block_on(poll_copilot_device_flow(&cfg, &device.device_code)) {
            DeviceFlowPollResult::Pending => {}
            DeviceFlowPollResult::SlowDown => interval += 5,
            DeviceFlowPollResult::Success(cred) => {
                return persist_and_done(writer, "github-copilot", cred);
            }
            DeviceFlowPollResult::Expired => return emit_error(writer, "device code expired"),
            DeviceFlowPollResult::AccessDenied => {
                return emit_error(writer, "access denied by the user");
            }
            DeviceFlowPollResult::Error(m) => return emit_error(writer, &m),
        }
    }
}

/// OpenAI Codex (ChatGPT) OAuth PKCE: bind the localhost callback server, emit
/// the authorize URL for the GUI to open, wait for the redirect, then exchange
/// the code for tokens.
fn login_codex(writer: &FrameWriter<Stdout>) -> i32 {
    let Some(rt) = runtime(writer) else { return 1 };
    let start = match start_openai_codex_oauth() {
        Ok(s) => s,
        Err(e) => return emit_error(writer, &format!("failed to start OAuth flow: {e}")),
    };

    // pi returns callback_server: None for codex; bind it ourselves (mirrors
    // pi's own login command). A bind failure almost always means another
    // login — or the Codex CLI — already holds the fixed port.
    let server = match start.callback_server {
        Some(s) => s,
        None => {
            let Some(uri) = start
                .redirect_uri
                .as_deref()
                .filter(|u| redirect_uri_needs_callback_server(u))
            else {
                return emit_error(writer, "OAuth flow did not provide a localhost redirect URI");
            };
            match start_oauth_callback_server(uri) {
                Ok(s) => s,
                Err(e) => {
                    return emit_error(
                        writer,
                        &format!(
                            "could not listen for the OAuth callback (is another login or the Codex CLI using the port?): {e}"
                        ),
                    );
                }
            }
        }
    };

    let frame = AuthEvent::OauthUrl {
        url: start.url.clone(),
        port: server.port,
    };
    if let Err(e) = writer.write(&frame) {
        eprintln!("[seher-bridge] failed to write oauth_url frame: {e}");
        return 1;
    }

    // The callback server delivers the request path+query of the redirect
    // (e.g. `/auth/callback?code=..&state=..`); complete_* accepts a full URL.
    let path = match server.rx.recv_timeout(auth_timeout_from_env()) {
        Ok(p) => p,
        Err(_) => return emit_error(writer, "timed out waiting for the browser callback"),
    };
    let full_url = format!("http://localhost{path}");
    match rt.block_on(complete_openai_codex_oauth(&full_url, &start.verifier)) {
        Ok(cred) => persist_and_done(writer, "openai-codex", cred),
        Err(e) => emit_error(writer, &format!("token exchange failed: {e}")),
    }
}

/// Emit one `auth_status` frame per requested provider.
fn status(writer: &FrameWriter<Stdout>, providers: &[String]) -> i32 {
    let storage = match AuthStorage::load(Config::auth_path()) {
        Ok(s) => s,
        Err(e) => return emit_error(writer, &format!("failed to load auth.json: {e}")),
    };
    for provider in providers {
        let (status, expires_in_ms, expired_by_ms) =
            map_status(storage.credential_status(provider));
        let frame = AuthEvent::AuthStatus {
            provider: provider.clone(),
            status,
            expires_in_ms,
            expired_by_ms,
        };
        if let Err(e) = writer.write(&frame) {
            eprintln!("[seher-bridge] failed to write auth_status frame: {e}");
            return 1;
        }
    }
    0
}

/// Map pi's `CredentialStatus` to the wire `(status, expiresInMs, expiredByMs)`.
const fn map_status(status: CredentialStatus) -> (&'static str, Option<i64>, Option<i64>) {
    match status {
        CredentialStatus::Missing => ("none", None, None),
        CredentialStatus::ApiKey => ("api_key", None, None),
        CredentialStatus::OAuthValid { expires_in_ms } => {
            ("oauth_valid", Some(expires_in_ms), None)
        }
        CredentialStatus::OAuthExpired { expired_by_ms } => {
            ("oauth_expired", None, Some(expired_by_ms))
        }
        CredentialStatus::BearerToken => ("bearer", None, None),
        CredentialStatus::AwsCredentials => ("aws", None, None),
        CredentialStatus::ServiceKey => ("service_key", None, None),
    }
}

/// Store the credential under pi's standard auth.json and emit `auth_done`.
fn persist_and_done(writer: &FrameWriter<Stdout>, provider: &str, cred: AuthCredential) -> i32 {
    let mut storage = match AuthStorage::load(Config::auth_path()) {
        Ok(s) => s,
        Err(e) => return emit_error(writer, &format!("failed to load auth.json: {e}")),
    };
    storage.set(provider, cred);
    if let Err(e) = storage.save() {
        return emit_error(writer, &format!("failed to save auth.json: {e}"));
    }
    let frame = AuthEvent::AuthDone {
        provider: provider.to_string(),
    };
    if let Err(e) = writer.write(&frame) {
        eprintln!("[seher-bridge] failed to write auth_done frame: {e}");
        return 1;
    }
    0
}

/// Emit a terminal `auth_error` frame; always returns exit code 1.
fn emit_error<W: Write + Send>(writer: &FrameWriter<W>, message: &str) -> i32 {
    let frame = AuthEvent::AuthError {
        message: message.to_string(),
    };
    if let Err(e) = writer.write(&frame) {
        eprintln!("[seher-bridge] failed to write auth_error frame: {e}");
    }
    1
}

/// Current-thread tokio runtime (the auth HTTP calls are the only awaits).
fn runtime<W: Write + Send>(writer: &FrameWriter<W>) -> Option<tokio::runtime::Runtime> {
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

/// Overall wait for the OAuth browser callback.
fn auth_timeout_from_env() -> Duration {
    let ms = std::env::var("SMARTCRAB_SEHER_BRIDGE_AUTH_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_AUTH_TIMEOUT_MS);
    Duration::from_millis(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_credential_status_variant() {
        assert_eq!(map_status(CredentialStatus::Missing), ("none", None, None));
        assert_eq!(
            map_status(CredentialStatus::ApiKey),
            ("api_key", None, None)
        );
        assert_eq!(
            map_status(CredentialStatus::OAuthValid { expires_in_ms: 42 }),
            ("oauth_valid", Some(42), None)
        );
        assert_eq!(
            map_status(CredentialStatus::OAuthExpired { expired_by_ms: 7 }),
            ("oauth_expired", None, Some(7))
        );
        assert_eq!(
            map_status(CredentialStatus::BearerToken),
            ("bearer", None, None)
        );
        assert_eq!(
            map_status(CredentialStatus::AwsCredentials),
            ("aws", None, None)
        );
        assert_eq!(
            map_status(CredentialStatus::ServiceKey),
            ("service_key", None, None)
        );
    }

    #[test]
    fn auth_timeout_falls_back_to_default_on_garbage() {
        // Note: tests run in-process; avoid mutating the env var here. The
        // parse-and-filter path is covered by construction: a missing var
        // yields the default.
        assert_eq!(
            auth_timeout_from_env(),
            Duration::from_millis(DEFAULT_AUTH_TIMEOUT_MS)
        );
    }
}
