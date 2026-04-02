use crate::engine::yaml_schema::{NextTarget, NodeDefinition, PipelineDefinition};
use crate::error::Result;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedNodeType {
    Input,
    Hidden,
    Output,
}

#[derive(Debug)]
pub struct ResolvedPipeline {
    pub definition: PipelineDefinition,
    pub node_types: HashMap<String, ResolvedNodeType>,
}

/// Parse a YAML pipeline definition string into a resolved pipeline.
///
/// # Errors
///
/// Returns [`AppError::Yaml`] if the YAML is invalid or missing required fields.
pub fn parse_pipeline(yaml: &str) -> Result<ResolvedPipeline> {
    let definition: PipelineDefinition = serde_yaml::from_str(yaml)?;
    let node_types = resolve_node_types(&definition.nodes);
    Ok(ResolvedPipeline {
        definition,
        node_types,
    })
}

fn resolve_node_types(nodes: &[NodeDefinition]) -> HashMap<String, ResolvedNodeType> {
    let mut referenced: HashSet<String> = HashSet::new();
    for node in nodes {
        if let Some(next) = &node.next {
            match next {
                NextTarget::Single(id) => {
                    referenced.insert(id.clone());
                }
                NextTarget::Multiple(ids) => {
                    referenced.extend(ids.iter().cloned());
                }
            }
        }
        if let Some(conds) = &node.conditions {
            for c in conds {
                referenced.insert(c.next.clone());
            }
        }
    }
    nodes
        .iter()
        .map(|node| {
            let is_referenced = referenced.contains(&node.id);
            let has_routing =
                node.next.is_some() || node.conditions.as_ref().is_some_and(|c| !c.is_empty());
            let node_type = if !is_referenced {
                ResolvedNodeType::Input
            } else if has_routing {
                ResolvedNodeType::Hidden
            } else {
                ResolvedNodeType::Output
            };
            (node.id.clone(), node_type)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE1_DISCORD: &str = r#"
name: discord-claude-bot
version: "1.0"
trigger:
  type: discord
  triggers: [mention, dm]
nodes:
  - id: receive_message
    name: Discord Receive
    next: process_with_claude
  - id: process_with_claude
    name: Claude Processing
    action:
      type: llm_call
      provider: claude
      prompt: "test"
      timeout_secs: 300
    next: send_reply
  - id: send_reply
    name: Discord Reply
"#;

    const EXAMPLE2_HEALTH_CHECK: &str = r#"
name: health-check
version: "1.0"
trigger:
  type: cron
  schedule: "*/5 * * * *"
nodes:
  - id: health_check
    name: Health Check Start
    next: check_api
  - id: check_api
    name: API Check
    action:
      type: http_request
      method: GET
      url_template: "https://api.example.com/health"
    conditions:
      - match:
          type: status_code
          codes: [500, 503]
        next: analyze_error
      - match:
          type: status_code
          codes: [200]
        next: notify
  - id: analyze_error
    name: Error Analysis
    action:
      type: llm_call
      provider: claude
      prompt: "Analyze this error"
      timeout_secs: 60
    next: notify
  - id: notify
    name: Send Notification
"#;

    const EXAMPLE3_LOOP: &str = r#"
name: code-review-loop
version: "1.0"
trigger:
  type: discord
  triggers: [mention]
max_loop_count: 5
nodes:
  - id: receive_code
    name: Code Receive
    next: review_code
  - id: review_code
    name: Code Review
    action:
      type: llm_call
      provider: claude
      prompt: "Review this code"
      timeout_secs: 120
    next: send_result
  - id: send_result
    name: Send Result
"#;

    #[test]
    fn test_parse_example1_discord_claude_bot() {
        let result = parse_pipeline(EXAMPLE1_DISCORD);
        assert!(result.is_ok(), "Parse should succeed: {:?}", result.err());
        let pipeline = result.unwrap_or_else(|e| panic!("should have been checked: {e:?}"));
        assert_eq!(pipeline.definition.name, "discord-claude-bot");

        let types = &pipeline.node_types;
        assert_eq!(
            types.get("receive_message"),
            Some(&ResolvedNodeType::Input),
            "receive_message should be Input"
        );
        assert_eq!(
            types.get("process_with_claude"),
            Some(&ResolvedNodeType::Hidden),
            "process_with_claude should be Hidden"
        );
        assert_eq!(
            types.get("send_reply"),
            Some(&ResolvedNodeType::Output),
            "send_reply should be Output"
        );
    }

    #[test]
    fn test_parse_example2_health_check() {
        let result = parse_pipeline(EXAMPLE2_HEALTH_CHECK);
        assert!(result.is_ok(), "Parse should succeed: {:?}", result.err());
        let pipeline = result.unwrap_or_else(|e| panic!("should have been checked: {e:?}"));
        assert_eq!(pipeline.definition.name, "health-check");

        let types = &pipeline.node_types;
        assert_eq!(
            types.get("health_check"),
            Some(&ResolvedNodeType::Input),
            "health_check should be Input"
        );
        assert_eq!(
            types.get("check_api"),
            Some(&ResolvedNodeType::Hidden),
            "check_api should be Hidden"
        );
        assert_eq!(
            types.get("analyze_error"),
            Some(&ResolvedNodeType::Hidden),
            "analyze_error should be Hidden"
        );
        assert_eq!(
            types.get("notify"),
            Some(&ResolvedNodeType::Output),
            "notify should be Output"
        );
    }

    #[test]
    fn test_parse_example3_loop() {
        let result = parse_pipeline(EXAMPLE3_LOOP);
        assert!(result.is_ok(), "Parse should succeed: {:?}", result.err());
        let pipeline = result.unwrap_or_else(|e| panic!("should have been checked: {e:?}"));
        assert_eq!(pipeline.definition.name, "code-review-loop");
        assert_eq!(pipeline.definition.max_loop_count, Some(5));

        let types = &pipeline.node_types;
        assert_eq!(
            types.get("receive_code"),
            Some(&ResolvedNodeType::Input),
            "receive_code should be Input"
        );
        assert_eq!(
            types.get("review_code"),
            Some(&ResolvedNodeType::Hidden),
            "review_code should be Hidden"
        );
        assert_eq!(
            types.get("send_result"),
            Some(&ResolvedNodeType::Output),
            "send_result should be Output"
        );
    }

    #[test]
    fn test_next_target_single_deserialization() {
        let yaml = r#"
name: test
version: "1.0"
trigger:
  type: discord
nodes:
  - id: a
    name: Node A
    next: b
  - id: b
    name: Node B
"#;
        let pipeline = parse_pipeline(yaml).unwrap_or_else(|e| panic!("should parse: {e:?}"));
        let node_a = pipeline
            .definition
            .nodes
            .iter()
            .find(|n| n.id == "a")
            .unwrap_or_else(|| panic!("node a should exist"));
        match &node_a.next {
            Some(NextTarget::Single(id)) => assert_eq!(id, "b"),
            other => panic!("Expected Single next, got: {other:?}"),
        }
    }

    #[test]
    fn test_next_target_multiple_deserialization() {
        let yaml = r#"
name: test
version: "1.0"
trigger:
  type: discord
nodes:
  - id: a
    name: Node A
    next:
      - b
      - c
  - id: b
    name: Node B
  - id: c
    name: Node C
"#;
        let pipeline = parse_pipeline(yaml).unwrap_or_else(|e| panic!("should parse: {e:?}"));
        let node_a = pipeline
            .definition
            .nodes
            .iter()
            .find(|n| n.id == "a")
            .unwrap_or_else(|| panic!("node a should exist"));
        match &node_a.next {
            Some(NextTarget::Multiple(ids)) => {
                assert_eq!(ids.len(), 2);
                assert!(ids.contains(&"b".to_owned()));
                assert!(ids.contains(&"c".to_owned()));
            }
            other => panic!("Expected Multiple next, got: {other:?}"),
        }
    }

    // --- chat_send action tests ---

    const EXAMPLE_DISCORD_CHAT_SEND: &str = r#"
name: discord-reply-bot
version: "1.0"
trigger:
  type: discord
  triggers: [mention, dm]
nodes:
  - id: receive
    name: Receive Message
    next: call_llm
  - id: call_llm
    name: LLM Processing
    action:
      type: llm_call
      provider: claude
      prompt: "Respond to the user message"
      timeout_secs: 60
    next: reply
  - id: reply
    name: Send Reply
    action:
      type: chat_send
      adapter: discord
      content_template: "{{output}}"
"#;

    #[test]
    fn test_parse_discord_pipeline_with_chat_send() {
        let result = parse_pipeline(EXAMPLE_DISCORD_CHAT_SEND);
        assert!(result.is_ok(), "Parse should succeed: {:?}", result.err());
        let pipeline = result.unwrap_or_else(|e| panic!("should have been checked: {e:?}"));
        assert_eq!(pipeline.definition.name, "discord-reply-bot");

        // Verify trigger config
        assert!(matches!(
            pipeline.definition.trigger.trigger_type,
            crate::engine::yaml_schema::TriggerType::Discord
        ));
        let triggers = pipeline.definition.trigger.triggers.as_deref();
        assert!(triggers.is_some());
        let triggers = triggers.unwrap_or_default();
        assert!(triggers.contains(&"mention".to_owned()));
        assert!(triggers.contains(&"dm".to_owned()));
    }

    #[test]
    fn test_chat_send_action_resolves_in_pipeline() {
        let result = parse_pipeline(EXAMPLE_DISCORD_CHAT_SEND);
        assert!(result.is_ok());
        let pipeline = result.unwrap_or_else(|e| panic!("should have been checked: {e:?}"));

        let reply_node = pipeline
            .definition
            .nodes
            .iter()
            .find(|n| n.id == "reply")
            .unwrap_or_else(|| panic!("reply node should exist"));

        match reply_node.action {
            Some(crate::engine::yaml_schema::NodeAction::ChatSend {
                ref adapter,
                ref channel_id,
                ref content_template,
            }) => {
                assert_eq!(adapter, "discord");
                assert!(channel_id.is_none());
                assert_eq!(content_template, "{{output}}");
            }
            ref other => panic!("Expected ChatSend action, got: {other:?}"),
        }
    }

    #[test]
    fn test_chat_send_node_type_resolution() {
        let result = parse_pipeline(EXAMPLE_DISCORD_CHAT_SEND);
        assert!(result.is_ok());
        let pipeline = result.unwrap_or_else(|e| panic!("should have been checked: {e:?}"));

        let types = &pipeline.node_types;
        // receive: no incoming edges -> Input
        assert_eq!(types.get("receive"), Some(&ResolvedNodeType::Input));
        // call_llm: referenced + has next -> Hidden
        assert_eq!(types.get("call_llm"), Some(&ResolvedNodeType::Hidden));
        // reply: referenced but no outgoing -> Output
        assert_eq!(types.get("reply"), Some(&ResolvedNodeType::Output));
    }

    #[test]
    fn test_chat_send_with_explicit_channel_id() {
        let yaml = r#"
name: discord-notify
version: "1.0"
trigger:
  type: discord
  triggers: [mention]
nodes:
  - id: receive
    name: Receive
    next: notify
  - id: notify
    name: Notify Channel
    action:
      type: chat_send
      adapter: discord
      channel_id: "99887766"
      content_template: "Alert: {{content}}"
"#;
        let result = parse_pipeline(yaml);
        assert!(result.is_ok());
        let pipeline = result.unwrap_or_else(|e| panic!("should parse: {e:?}"));

        let notify_node = pipeline
            .definition
            .nodes
            .iter()
            .find(|n| n.id == "notify")
            .unwrap_or_else(|| panic!("notify node should exist"));

        match notify_node.action {
            Some(crate::engine::yaml_schema::NodeAction::ChatSend {
                ref adapter,
                ref channel_id,
                ref content_template,
            }) => {
                assert_eq!(adapter, "discord");
                assert_eq!(channel_id, &Some("99887766".to_owned()));
                assert_eq!(content_template, "Alert: {{content}}");
            }
            ref other => panic!("Expected ChatSend action, got: {other:?}"),
        }
    }
}
