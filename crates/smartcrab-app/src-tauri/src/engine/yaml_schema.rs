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
}
