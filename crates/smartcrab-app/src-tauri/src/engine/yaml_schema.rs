use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineDefinition {
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub trigger: TriggerConfig,
    pub max_loop_count: Option<u32>,
    pub nodes: Vec<NodeDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerConfig {
    #[serde(rename = "type")]
    pub trigger_type: TriggerType,
    pub triggers: Option<Vec<String>>,
    pub schedule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerType {
    Discord,
    Cron,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDefinition {
    pub id: String,
    pub name: String,
    pub action: Option<NodeAction>,
    #[serde(default)]
    pub next: Option<NextTarget>,
    #[serde(default)]
    pub conditions: Option<Vec<Condition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NextTarget {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    #[serde(rename = "match")]
    pub match_rule: MatchCondition,
    pub next: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MatchCondition {
    Regex {
        pattern: String,
    },
    StatusCode {
        codes: Vec<u16>,
    },
    JsonPath {
        path: String,
        expected: serde_json::Value,
    },
    ExitWhen {
        pattern: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeAction {
    LlmCall {
        provider: String,
        prompt: String,
        timeout_secs: u64,
    },
    HttpRequest {
        method: String,
        url_template: String,
        #[serde(default)]
        headers: Option<HashMap<String, String>>,
        body_template: Option<String>,
    },
    ShellCommand {
        command_template: String,
        working_dir: Option<String>,
        timeout_secs: u64,
    },
    ChatSend {
        adapter: String,
        #[serde(default)]
        channel_id: Option<String>,
        content_template: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_send_action_serializes_with_tag() {
        let action = NodeAction::ChatSend {
            adapter: "discord".to_owned(),
            channel_id: Some("123456".to_owned()),
            content_template: "Hello {{author}}".to_owned(),
        };
        let json = serde_json::to_string(&action)
            .unwrap_or_else(|e| panic!("serialize should succeed: {e}"));
        assert!(json.contains("\"type\":\"chat_send\""));
        assert!(json.contains("\"adapter\":\"discord\""));
        assert!(json.contains("\"content_template\":\"Hello {{author}}\""));
    }

    #[test]
    fn chat_send_action_deserializes_with_all_fields() {
        let json = r#"{"type":"chat_send","adapter":"discord","channel_id":"789","content_template":"Reply"}"#;
        let action: NodeAction = serde_json::from_str(json)
            .unwrap_or_else(|e| panic!("deserialize should succeed: {e}"));
        match action {
            NodeAction::ChatSend {
                adapter,
                channel_id,
                content_template,
            } => {
                assert_eq!(adapter, "discord");
                assert_eq!(channel_id, Some("789".to_owned()));
                assert_eq!(content_template, "Reply");
            }
            other => panic!("Expected ChatSend, got: {other:?}"),
        }
    }

    #[test]
    fn chat_send_action_deserializes_without_optional_channel_id() {
        let json = r#"{"type":"chat_send","adapter":"discord","content_template":"Hello"}"#;
        let action: NodeAction = serde_json::from_str(json)
            .unwrap_or_else(|e| panic!("deserialize should succeed: {e}"));
        match action {
            NodeAction::ChatSend { channel_id, .. } => {
                assert_eq!(channel_id, None);
            }
            other => panic!("Expected ChatSend, got: {other:?}"),
        }
    }

    #[test]
    fn chat_send_action_round_trip() {
        let action = NodeAction::ChatSend {
            adapter: "discord".to_owned(),
            channel_id: None,
            content_template: "{{output}}".to_owned(),
        };
        let json = serde_json::to_string(&action).unwrap_or_else(|e| panic!("serialize: {e}"));
        let parsed: NodeAction =
            serde_json::from_str(&json).unwrap_or_else(|e| panic!("deserialize: {e}"));
        match parsed {
            NodeAction::ChatSend {
                adapter,
                channel_id,
                content_template,
            } => {
                assert_eq!(adapter, "discord");
                assert!(channel_id.is_none());
                assert_eq!(content_template, "{{output}}");
            }
            other => panic!("Expected ChatSend, got: {other:?}"),
        }
    }
}
