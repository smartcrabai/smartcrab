//! NDJSON stdio protocol frames exchanged with the bun-service.
//!
//! UTF-8, newline-delimited JSON. Every object carries a `"type"` field. stdout
//! is reserved for protocol frames (one frame per line); logs go to stderr only.
//! The bun side implements the same wire format (see the migration spec).

use serde::{Deserialize, Serialize};

/// A tool definition the model may call, forwarded from the bun side.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    /// JSON Schema (`type: object`) describing the tool input.
    pub parameters: serde_json::Value,
}

/// Frames sent bun -> bridge over stdin.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Incoming {
    /// First (and only) line: the run request.
    Run(RunRequest),
    /// Response to a `tool_call`. Exactly one of `output` / `error` is set.
    ToolResult(ToolResult),
}

/// The `run` request: the first stdin line, sent exactly once.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub prompt: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// seher mode key (YAML `models.<key>`). `null` => `"build"`.
    #[serde(default)]
    pub model: Option<String>,
    /// Forwarded to `ResolveOptions.config_path`.
    #[serde(default)]
    pub config_path: Option<String>,
    #[serde(default)]
    pub tools: Vec<ToolDef>,
}

/// Response to a `tool_call`. `output` and `error` are mutually exclusive.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ToolResult {
    pub id: String,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Frames sent bridge -> bun over stdout.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Outgoing {
    /// A model tool invocation. `id` is bridge-generated, unique within the run.
    ToolCall {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// Terminal success frame. `kind` is always `"pi"`.
    Done {
        text: String,
        kind: &'static str,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    /// Terminal rate/usage-limit frame.
    Limit {
        message: String,
        partial: Option<String>,
    },
    /// Terminal error frame.
    Error {
        message: String,
        partial: Option<String>,
    },
}

impl Outgoing {
    /// Build a `done` frame (sets `kind` to the constant `"pi"`).
    #[must_use]
    pub fn done(text: String, session_id: String) -> Self {
        Self::Done {
            text,
            kind: "pi",
            session_id,
        }
    }

    /// Whether this frame indicates success (`done`). Used to pick the process
    /// exit code: `done` => 0, every other terminal frame => non-zero.
    #[must_use]
    pub const fn is_success(&self) -> bool {
        matches!(self, Self::Done { .. })
    }
}

/// Frames emitted by the `auth` subcommand (bridge -> bun over stdout).
///
/// `auth login` emits exactly one progress frame (`device_code` or `oauth_url`)
/// followed by exactly one terminal frame (`auth_done` => exit 0, `auth_error`
/// => non-zero). `auth status` emits one `auth_status` per requested provider
/// and exits 0.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthEvent {
    /// Device-flow start (RFC 8628): show `userCode`, open the URI, then the
    /// bridge polls until the user authorizes.
    #[serde(rename_all = "camelCase")]
    DeviceCode {
        user_code: String,
        verification_uri: String,
        /// URI with the code pre-filled; falls back to `verification_uri`.
        verification_uri_complete: String,
        expires_in: u64,
        interval: u64,
    },
    /// Browser OAuth start (PKCE): open `url`; the bridge listens for the
    /// localhost callback on `port`.
    #[serde(rename_all = "camelCase")]
    OauthUrl { url: String, port: u16 },
    /// Terminal: credential persisted to pi's auth.json.
    AuthDone { provider: String },
    /// Terminal: the login flow failed.
    AuthError { message: String },
    /// One per provider requested via `auth status`. `status` mirrors pi's
    /// `CredentialStatus`: none | api_key | oauth_valid | oauth_expired |
    /// bearer | aws | service_key.
    #[serde(rename_all = "camelCase")]
    AuthStatus {
        provider: String,
        status: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_in_ms: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        expired_by_ms: Option<i64>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_run_with_camel_case_fields() {
        let line = r#"{"type":"run","prompt":"hi","systemPrompt":"sys","model":"plan","configPath":"/tmp/c.yaml","tools":[{"name":"echo","description":"d","parameters":{"type":"object"}}]}"#;
        let incoming: Incoming = serde_json::from_str(line).expect("parse run");
        let Incoming::Run(req) = incoming else {
            panic!("expected run");
        };
        assert_eq!(req.prompt, "hi");
        assert_eq!(req.system_prompt.as_deref(), Some("sys"));
        assert_eq!(req.model.as_deref(), Some("plan"));
        assert_eq!(req.config_path.as_deref(), Some("/tmp/c.yaml"));
        assert_eq!(req.tools.len(), 1);
        assert_eq!(req.tools[0].name, "echo");
    }

    #[test]
    fn deserializes_run_with_nulls_and_missing_tools() {
        let line = r#"{"type":"run","prompt":"hi","systemPrompt":null,"model":null,"configPath":null}"#;
        let incoming: Incoming = serde_json::from_str(line).expect("parse run");
        let Incoming::Run(req) = incoming else {
            panic!("expected run");
        };
        assert_eq!(req.system_prompt, None);
        assert_eq!(req.model, None);
        assert_eq!(req.config_path, None);
        assert!(req.tools.is_empty());
    }

    #[test]
    fn deserializes_tool_result_output_and_error() {
        let ok: Incoming =
            serde_json::from_str(r#"{"type":"tool_result","id":"t1","output":"ok"}"#)
                .expect("parse output");
        assert_eq!(
            ok,
            Incoming::ToolResult(ToolResult {
                id: "t1".to_string(),
                output: Some("ok".to_string()),
                error: None,
            })
        );
        let err: Incoming =
            serde_json::from_str(r#"{"type":"tool_result","id":"t2","error":"boom"}"#)
                .expect("parse error");
        assert_eq!(
            err,
            Incoming::ToolResult(ToolResult {
                id: "t2".to_string(),
                output: None,
                error: Some("boom".to_string()),
            })
        );
    }

    #[test]
    fn serializes_tool_call_frame() {
        let frame = Outgoing::ToolCall {
            id: "c1".to_string(),
            name: "echo".to_string(),
            input: serde_json::json!({"text": "hi"}),
        };
        let json = serde_json::to_string(&frame).expect("serialize");
        assert_eq!(
            json,
            r#"{"type":"tool_call","id":"c1","name":"echo","input":{"text":"hi"}}"#
        );
    }

    #[test]
    fn serializes_done_frame_with_pi_kind_and_session_id() {
        let frame = Outgoing::done("hello".to_string(), "sess-1".to_string());
        let json = serde_json::to_string(&frame).expect("serialize");
        assert_eq!(
            json,
            r#"{"type":"done","text":"hello","kind":"pi","sessionId":"sess-1"}"#
        );
        assert!(frame.is_success());
    }

    #[test]
    fn serializes_device_code_frame_with_camel_case_fields() {
        let frame = AuthEvent::DeviceCode {
            user_code: "WDJB-MJHT".to_string(),
            verification_uri: "https://github.com/login/device".to_string(),
            verification_uri_complete: "https://github.com/login/device?user_code=WDJB-MJHT"
                .to_string(),
            expires_in: 899,
            interval: 5,
        };
        assert_eq!(
            serde_json::to_string(&frame).expect("serialize"),
            r#"{"type":"device_code","userCode":"WDJB-MJHT","verificationUri":"https://github.com/login/device","verificationUriComplete":"https://github.com/login/device?user_code=WDJB-MJHT","expiresIn":899,"interval":5}"#
        );
    }

    #[test]
    fn serializes_oauth_url_frame() {
        let frame = AuthEvent::OauthUrl {
            url: "https://auth.openai.com/oauth/authorize?x=1".to_string(),
            port: 1455,
        };
        assert_eq!(
            serde_json::to_string(&frame).expect("serialize"),
            r#"{"type":"oauth_url","url":"https://auth.openai.com/oauth/authorize?x=1","port":1455}"#
        );
    }

    #[test]
    fn serializes_auth_terminal_frames() {
        let done = AuthEvent::AuthDone {
            provider: "github-copilot".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&done).expect("serialize"),
            r#"{"type":"auth_done","provider":"github-copilot"}"#
        );
        let err = AuthEvent::AuthError {
            message: "denied".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&err).expect("serialize"),
            r#"{"type":"auth_error","message":"denied"}"#
        );
    }

    #[test]
    fn serializes_auth_status_frames_omitting_absent_expiries() {
        let valid = AuthEvent::AuthStatus {
            provider: "github-copilot".to_string(),
            status: "oauth_valid",
            expires_in_ms: Some(3_500_000),
            expired_by_ms: None,
        };
        assert_eq!(
            serde_json::to_string(&valid).expect("serialize"),
            r#"{"type":"auth_status","provider":"github-copilot","status":"oauth_valid","expiresInMs":3500000}"#
        );
        let none = AuthEvent::AuthStatus {
            provider: "openai-codex".to_string(),
            status: "none",
            expires_in_ms: None,
            expired_by_ms: None,
        };
        assert_eq!(
            serde_json::to_string(&none).expect("serialize"),
            r#"{"type":"auth_status","provider":"openai-codex","status":"none"}"#
        );
    }

    #[test]
    fn serializes_limit_and_error_frames() {
        let limit = Outgoing::Limit {
            message: "rate".to_string(),
            partial: Some("p".to_string()),
        };
        assert_eq!(
            serde_json::to_string(&limit).expect("serialize"),
            r#"{"type":"limit","message":"rate","partial":"p"}"#
        );
        let error = Outgoing::Error {
            message: "bad".to_string(),
            partial: None,
        };
        assert_eq!(
            serde_json::to_string(&error).expect("serialize"),
            r#"{"type":"error","message":"bad","partial":null}"#
        );
        assert!(!limit.is_success());
        assert!(!error.is_success());
    }
}
