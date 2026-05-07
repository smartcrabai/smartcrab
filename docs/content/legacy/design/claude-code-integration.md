+++
title = "Claude Code Integration"
description = "Claude Code integration design — subprocess execution, data exchange, test strategy"
weight = 4
+++

## Role of Claude Code

In SmartCrab, Claude Code is the AI processing engine conditionally invoked from Hidden Layers and Output Layers. It fulfills the "AI" part of the "Tool-to-AI" paradigm.

Claude Code is used in the following scenarios:

- **Analysis & Reasoning**: Parsing unstructured data, understanding natural language
- **Generation**: Text generation, code generation, report creation
- **Decision-making**: Complex condition evaluation, classification, prioritization

## Invocation Patterns

### Basic Pattern

{% mermaid() %}
sequenceDiagram
    participant L as Layer
    participant CC as ClaudeCode Helper
    participant P as claude Process

    L->>CC: ClaudeCode::new().prompt(&prompt)
    CC->>P: spawn claude subprocess
    CC->>P: Write prompt to stdin
    P-->>CC: Read response from stdout
    CC-->>L: Result<String>
{% end %}

### Usage in a Hidden Layer

```rust
// DTO → prompt → Claude Code → response → DTO
async fn run(&self, input: Self::Input) -> Result<Self::Output> {
    let prompt = build_prompt(&input);
    let response = ClaudeCode::new()
        .prompt(&prompt)
        .await?;
    parse_response(&response)
}
```

### Usage in an Output Layer

```rust
// DTO → prompt → Claude Code → side effect (file generation, etc.)
async fn run(&self, input: Self::Input) -> Result<()> {
    let prompt = build_prompt(&input);
    ClaudeCode::new()
        .with_allowed_tools(&["write", "edit"])
        .prompt(&prompt)
        .await?;
    Ok(())
}
```

## Builder API

`ClaudeCode` uses a builder pattern to configure the invocation:

```rust
ClaudeCode::new()
    .with_timeout(Duration::from_secs(60))
    .with_system_prompt("You are a helpful assistant.")
    .with_allowed_tools(&["write", "edit"])
    .with_max_turns(3)
    .prompt(&prompt)
    .await?
```

## Data Exchange

### DTO → Prompt Conversion

DTOs are converted into prompts to be passed to Claude Code. JSON serialization is the primary strategy.

```rust
fn build_prompt(input: &impl Dto) -> String {
    let json = serde_json::to_string_pretty(input).unwrap();
    format!(
        "Please process the following JSON data and return the result in JSON format.\n\n\
         Input data:\n```json\n{json}\n```\n\n\
         Output schema:\n```json\n{schema}\n```",
        json = json,
        schema = "{ ... }",
    )
}
```

### Response → DTO Parsing

DTOs are restored from Claude Code responses. `--output-format json` forces a JSON response, which is then parsed with `serde_json::from_str`.

```rust
fn parse_response<T: Dto>(response: &str) -> Result<T> {
    // For JSON output format, get text from the result field
    let claude_output: ClaudeOutput = serde_json::from_str(response)?;
    let dto: T = serde_json::from_str(&claude_output.result)?;
    Ok(dto)
}
```

Fallback when parsing fails:

1. Attempt to extract a JSON block (` ```json ... ``` `)
2. If that also fails, return `SmartCrabError::ResponseParseError`

## Error Handling

| Error Type | Cause | Error Kind |
|-----------|------|---------|
| Launch failure | `claude` command not found | `SmartCrabError::ClaudeCodeNotFound` |
| Timeout | No response within the specified time | `SmartCrabError::ClaudeCodeTimeout { timeout }` |
| Non-zero exit | Claude Code exits with an error | `SmartCrabError::ClaudeCodeFailed { exit_code, stderr }` |
| Parse error | Response is not in the expected format | `SmartCrabError::ResponseParseError { response, source }` |

{% mermaid() %}
flowchart TD
    Start([Execute claude command]) --> Spawn{spawn successful?}
    Spawn -->|No| NotFound[ClaudeCodeNotFound]
    Spawn -->|Yes| Wait[Waiting for response]
    Wait --> Timeout{Timeout?}
    Timeout -->|Yes| TimeoutErr[ClaudeCodeTimeout]
    Timeout -->|No| Exit{Exit code?}
    Exit -->|Non-zero| Failed[ClaudeCodeFailed]
    Exit -->|0| Parse{Parse successful?}
    Parse -->|No| ParseErr[ResponseParseError]
    Parse -->|Yes| Ok([Result::Ok])
{% end %}

## Test Strategy

### Mocking Approach

Abstract the Claude Code invocation so it can be replaced with a mock during testing. The `ClaudeCodeExecutor` trait allows injecting either the real subprocess implementation or a test mock.

### Test Levels

| Level | Scope | Claude Code |
|--------|------|-------------|
| Unit test | Individual Node | Mock |
| Integration test | Full Graph | Mock |
| E2E test | Full application | Real claude command |

### Unit Test Example

```rust
#[tokio::test]
async fn test_ai_analysis_layer() {
    let mock = MockClaudeCode::new()
        .with_response(
            r#"{"severity": "high", "summary": "Critical issue found"}"#,
        );

    let layer = AiAnalysis::new_with_executor(mock);
    let input = AnalysisInput {
        data: "test data".to_string(),
    };

    let output = layer.run(input).await.unwrap();
    assert_eq!(output.severity, "high");
}
```
