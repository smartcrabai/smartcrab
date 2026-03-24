use serde::Serialize;

use crate::error::AppError;

/// Response from the Claude CLI chat command.
#[derive(Debug, Clone, Serialize)]
pub struct ChatResponse {
    pub message: String,
    pub yaml_content: Option<String>,
}

/// System prompt used when asking Claude to generate a pipeline YAML.
const SYSTEM_PROMPT: &str = "\
You are a SmartCrab pipeline YAML generator. \
When the user describes a workflow, respond with a brief description \
followed by a fenced YAML code block containing the pipeline definition. \
The pipeline YAML must have at minimum a 'name' key and a 'nodes' list. \
Do not include any other fenced code blocks in your response.";

/// Generate a pipeline YAML from a natural-language prompt using the Claude CLI.
///
/// # Errors
///
/// Returns [`AppError::ClaudeCli`] if the `claude` binary cannot be spawned,
/// exits with a non-zero status, or produces non-UTF-8 output.
#[tauri::command]
pub async fn chat_create_pipeline(prompt: String) -> Result<ChatResponse, AppError> {
    let full_prompt = format!("{SYSTEM_PROMPT}\n\nUser request: {prompt}");

    let output = tokio::process::Command::new("claude")
        .arg("-p")
        .arg(&full_prompt)
        .output()
        .await
        .map_err(|e| AppError::ClaudeCli(format!("failed to spawn claude CLI: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::ClaudeCli(format!(
            "claude CLI exited with error: {stderr}"
        )));
    }

    let message = String::from_utf8(output.stdout)
        .map_err(|e| AppError::ClaudeCli(format!("invalid UTF-8 from claude CLI: {e}")))?;

    let yaml_content = extract_yaml_block(&message);

    Ok(ChatResponse {
        message: message.trim().to_owned(),
        yaml_content,
    })
}

/// Extract the content of the first fenced `yaml` (or unlabelled) code block.
fn extract_yaml_block(text: &str) -> Option<String> {
    // Look for ```yaml ... ``` first, then fall back to ``` ... ```.
    if let Some(start) = text.find("```yaml\n") {
        let content_start = start + "```yaml\n".len();
        if let Some(end) = text[content_start..].find("```") {
            return Some(text[content_start..content_start + end].trim().to_owned());
        }
    }
    if let Some(start) = text.find("```\n") {
        let content_start = start + "```\n".len();
        if let Some(end) = text[content_start..].find("```") {
            return Some(text[content_start..content_start + end].trim().to_owned());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_yaml_block_labelled() {
        let text = "Here is your pipeline:\n```yaml\nname: Test\nnodes: []\n```\nDone.";
        let yaml = extract_yaml_block(text);
        assert!(yaml.is_some());
        let yaml = yaml.unwrap_or_else(|| panic!("should have yaml block"));
        assert!(yaml.contains("name: Test"));
    }

    #[test]
    fn extract_yaml_block_unlabelled() {
        let text = "Pipeline:\n```\nname: Unlabelled\nnodes: []\n```";
        let yaml = extract_yaml_block(text);
        assert!(yaml.is_some());
        let yaml = yaml.unwrap_or_else(|| panic!("should have yaml block"));
        assert!(yaml.contains("name: Unlabelled"));
    }

    #[test]
    fn extract_yaml_block_none() {
        let text = "No code blocks here.";
        let yaml = extract_yaml_block(text);
        assert!(yaml.is_none());
    }

    #[test]
    fn chat_response_serializes() {
        let resp = ChatResponse {
            message: "Pipeline created".to_owned(),
            yaml_content: Some("name: Test\nnodes: []".to_owned()),
        };
        let json = serde_json::to_string(&resp);
        assert!(json.is_ok());
        let s = json.unwrap_or_else(|e| panic!("serialize should succeed: {e}"));
        assert!(s.contains("Pipeline created"));
        assert!(s.contains("yaml_content"));
    }
}
