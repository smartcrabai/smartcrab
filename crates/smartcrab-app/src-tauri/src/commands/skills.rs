use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::AppError;

/// Information about a generated skill file.
#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub skill_type: String,
    pub pipeline_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A minimal representation of a pipeline stored in the DB.
#[derive(Debug, Clone)]
struct PipelineRecord {
    pub name: String,
    pub description: Option<String>,
    pub yaml: String,
}

/// List all generated skills.
///
/// # Errors
///
/// Returns [`AppError`] if the database lock is poisoned or the query fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State must be passed by value"
)]
pub fn list_skills(db: State<'_, DbState>) -> Result<Vec<SkillInfo>, AppError> {
    let conn = db.lock()?;
    list_skills_db(&conn)
}

/// Generate a skill Markdown file from a stored pipeline YAML and register it.
///
/// # Errors
///
/// Returns [`AppError::NotFound`] if the pipeline does not exist, or
/// [`AppError`] for IO or database failures.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn generate_skill(db: State<'_, DbState>, pipeline_id: String) -> Result<SkillInfo, AppError> {
    let conn = db.lock()?;
    generate_skill_db(&conn, &pipeline_id)
}

/// Invoke a skill by its id, feeding the skill definition to the LLM adapter.
///
/// # Errors
///
/// Returns [`AppError::NotFound`] if no skill with `skill_id` exists,
/// [`AppError::Io`] if the skill file cannot be read, or adapter errors on
/// execution failure.
#[tauri::command]
pub async fn invoke_skill(
    db: State<'_, DbState>,
    skill_id: String,
    input: serde_json::Value,
) -> Result<SkillInvocationResult, AppError> {
    let adapter = crate::adapters::llm::claude::ClaudeLlmAdapter::new();

    // Scope the DB lock so it is dropped before the async adapter call.
    let (skill, skill_content) = {
        let conn = db.lock()?;
        let skill = lookup_skill_db(&conn, &skill_id)?;
        let content = std::fs::read_to_string(&skill.file_path)?;
        (skill, content)
    };

    execute_skill_prompt(&skill, &skill_content, &input, &adapter).await
}

/// Delete a skill by id (removes the file and the DB record).
///
/// # Errors
///
/// Returns [`AppError::NotFound`] if no skill with the given id exists, or
/// [`AppError`] for database failures.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn delete_skill(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db.lock()?;
    delete_skill_db(&conn, &id)
}

// ---------------------------------------------------------------------------
// Standalone helpers (no Tauri State) used by tests
// ---------------------------------------------------------------------------

pub(crate) fn list_skills_db(conn: &rusqlite::Connection) -> Result<Vec<SkillInfo>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, file_path, skill_type, pipeline_id, created_at, updated_at
         FROM skills
         ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SkillInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            file_path: row.get(3)?,
            skill_type: row.get(4)?,
            pipeline_id: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    let mut skills = Vec::new();
    for row in rows {
        skills.push(row?);
    }
    Ok(skills)
}

pub(crate) fn generate_skill_db(
    conn: &rusqlite::Connection,
    pipeline_id: &str,
) -> Result<SkillInfo, AppError> {
    let record = load_pipeline(conn, pipeline_id)?;

    let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/tmp"));
    let smartcrab_dir = std::path::PathBuf::from(home).join(".smartcrab");
    let claude_dir = smartcrab_dir.join(".claude").join("skills");
    let agents_dir = smartcrab_dir.join(".agents").join("skills");

    std::fs::create_dir_all(&claude_dir)?;
    std::fs::create_dir_all(&agents_dir)?;

    let safe_name: String = record
        .name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let content = build_skill_content(&record.name, record.description.as_deref(), &record.yaml);

    let claude_path = claude_dir.join(format!("{safe_name}.md"));
    let agents_path = agents_dir.join(format!("{safe_name}.md"));

    std::fs::write(&claude_path, &content)?;
    std::fs::write(&agents_path, &content)?;

    let file_path = claude_path
        .to_str()
        .ok_or_else(|| AppError::InvalidInput("non-UTF8 path".to_owned()))?
        .to_owned();

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO skills (id, name, description, file_path, skill_type, pipeline_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'pipeline', ?5, ?6, ?6)",
        rusqlite::params![id, record.name, record.description, file_path, pipeline_id, now],
    )?;

    Ok(SkillInfo {
        id,
        name: record.name,
        description: record.description,
        file_path,
        skill_type: "pipeline".to_owned(),
        pipeline_id: Some(pipeline_id.to_owned()),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub(crate) fn delete_skill_db(conn: &rusqlite::Connection, id: &str) -> Result<(), AppError> {
    let file_path: Option<String> = conn
        .query_row("SELECT file_path FROM skills WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .ok();

    let affected = conn.execute("DELETE FROM skills WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("skill '{id}' not found")));
    }

    if let Some(path) = file_path {
        let _ = std::fs::remove_file(&path);
        let agents_mirror =
            path.replace("/.smartcrab/.claude/skills/", "/.smartcrab/.agents/skills/");
        if agents_mirror != path {
            let _ = std::fs::remove_file(&agents_mirror);
        }
    }

    Ok(())
}

fn load_pipeline(
    conn: &rusqlite::Connection,
    pipeline_id: &str,
) -> Result<PipelineRecord, AppError> {
    conn.query_row(
        "SELECT name, description, yaml_content FROM pipelines WHERE id = ?1",
        [pipeline_id],
        |row| {
            Ok(PipelineRecord {
                name: row.get(0)?,
                description: row.get(1)?,
                yaml: row.get(2)?,
            })
        },
    )
    .map_err(|_| AppError::NotFound(format!("pipeline '{pipeline_id}' not found")))
}

fn build_skill_content(name: &str, description: Option<&str>, yaml: &str) -> String {
    let desc = description.unwrap_or("");
    format!("# {name}\n\n{desc}\n\n## YAML\n```yaml\n{yaml}\n```\n")
}

// ---------------------------------------------------------------------------
// invoke_skill helpers
// ---------------------------------------------------------------------------

/// Result of invoking a skill via the LLM adapter.
#[derive(Debug, Clone, Serialize)]
pub struct SkillInvocationResult {
    pub skill_id: String,
    pub skill_name: String,
    pub output: String,
}

/// Look up a single skill by ID from the database.
///
/// # Errors
///
/// Returns [`AppError::NotFound`] if no skill with `skill_id` exists.
pub(crate) fn lookup_skill_db(
    conn: &rusqlite::Connection,
    skill_id: &str,
) -> Result<SkillInfo, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, file_path, skill_type, pipeline_id, created_at, updated_at
         FROM skills WHERE id = ?1",
    )?;
    stmt.query_row([skill_id], |row| {
        Ok(SkillInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            file_path: row.get(3)?,
            skill_type: row.get(4)?,
            pipeline_id: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|_| AppError::NotFound(format!("skill '{skill_id}' not found")))
}

/// Build a prompt string from skill markdown content and user input.
///
/// If `input` is a JSON string, the raw string value is embedded directly.
/// Otherwise, the input is pretty-printed as JSON.
fn build_skill_prompt(skill_content: &str, input: &serde_json::Value) -> String {
    let input_str = match input {
        serde_json::Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other)
            .unwrap_or_else(|e| format!("{{\"error\": \"Failed to serialize input: {e}\"}}")),
    };
    format!("# Skill Definition\n\n{skill_content}\n\n---\n\n# User Input\n\n{input_str}")
}

/// Test helper: invoke a skill end-to-end with an injected adapter.
#[cfg(test)]
pub(crate) async fn invoke_skill_db(
    conn: &rusqlite::Connection,
    skill_id: &str,
    input: serde_json::Value,
    adapter: &dyn crate::adapters::llm::LlmAdapter,
) -> Result<SkillInvocationResult, AppError> {
    let skill = lookup_skill_db(conn, skill_id)?;
    let skill_content = std::fs::read_to_string(&skill.file_path)?;
    execute_skill_prompt(&skill, &skill_content, &input, adapter).await
}

async fn execute_skill_prompt(
    skill: &SkillInfo,
    skill_content: &str,
    input: &serde_json::Value,
    adapter: &dyn crate::adapters::llm::LlmAdapter,
) -> Result<SkillInvocationResult, AppError> {
    let prompt = build_skill_prompt(skill_content, input);
    let request = crate::adapters::llm::LlmRequest {
        prompt,
        timeout_secs: None,
        metadata: None,
    };
    let response = adapter.execute_prompt(&request).await?;
    Ok(SkillInvocationResult {
        skill_id: skill.id.clone(),
        skill_name: skill.name.clone(),
        output: response.content,
    })
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) fn insert_test_pipeline(
    conn: &rusqlite::Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    yaml: &str,
) {
    conn.execute(
        "INSERT INTO pipelines (id, name, description, yaml_content, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        rusqlite::params![id, name, description, yaml],
    )
    .unwrap_or_else(|e| panic!("insert test pipeline: {e}"));
}

#[cfg(test)]
pub(crate) fn insert_test_skill(
    conn: &rusqlite::Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    file_path: &str,
    skill_type: &str,
    pipeline_id: Option<&str>,
) {
    conn.execute(
        "INSERT INTO skills (id, name, description, file_path, skill_type, pipeline_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        rusqlite::params![id, name, description, file_path, skill_type, pipeline_id],
    )
    .unwrap_or_else(|e| panic!("insert test skill: {e}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::llm::{LlmAdapter, LlmCapabilities, LlmRequest, LlmResponse};
    use crate::commands::test_db;
    use async_trait::async_trait;
    use std::sync::Mutex;

    #[test]
    fn list_skills_empty() {
        let conn = test_db();
        let skills = list_skills_db(&conn).unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert!(skills.is_empty());
    }

    #[test]
    fn generate_skill_pipeline_not_found() {
        let conn = test_db();
        let result = generate_skill_db(&conn, "nonexistent-pipeline");
        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be NotFound")
        };
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn generate_skill_creates_record() {
        let conn = test_db();
        insert_test_pipeline(
            &conn,
            "pl-1",
            "MyPipeline",
            Some("A test pipeline"),
            "name: MyPipeline\nnodes: []",
        );
        let skill = generate_skill_db(&conn, "pl-1")
            .unwrap_or_else(|e| panic!("should generate skill: {e}"));
        assert_eq!(skill.name, "MyPipeline");
        assert_eq!(skill.pipeline_id, Some("pl-1".to_owned()));
        assert!(skill.file_path.contains("MyPipeline"));

        let skills = list_skills_db(&conn).unwrap_or_else(|e| panic!("should list: {e}"));
        assert_eq!(skills.len(), 1);
    }

    #[test]
    fn delete_skill_removes_record() {
        let conn = test_db();
        insert_test_pipeline(
            &conn,
            "pl-2",
            "AnotherPipeline",
            None,
            "name: AnotherPipeline\nnodes: []",
        );
        let skill = generate_skill_db(&conn, "pl-2")
            .unwrap_or_else(|e| panic!("should generate skill: {e}"));
        delete_skill_db(&conn, &skill.id).unwrap_or_else(|e| panic!("should delete: {e}"));
        let skills = list_skills_db(&conn).unwrap_or_else(|e| panic!("should list: {e}"));
        assert!(skills.is_empty());
    }

    #[test]
    fn delete_skill_not_found() {
        let conn = test_db();
        let result = delete_skill_db(&conn, "nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn build_skill_content_format() {
        let content = build_skill_content("TestPipe", Some("Desc here"), "name: TestPipe");
        assert!(content.contains("# TestPipe"));
        assert!(content.contains("Desc here"));
        assert!(content.contains("```yaml"));
        assert!(content.contains("name: TestPipe"));
    }

    // ---------------------------------------------------------------
    // invoke_skill tests
    // ---------------------------------------------------------------

    // --- lookup_skill_db ---

    #[test]
    fn lookup_skill_db_found() {
        let conn = test_db();

        insert_test_skill(
            &conn,
            "sk-1",
            "MySkill",
            Some("A test skill"),
            "/tmp/test-skill.md",
            "pipeline",
            Some("pl-1"),
        );

        let skill =
            lookup_skill_db(&conn, "sk-1").unwrap_or_else(|e| panic!("should find skill: {e}"));

        assert_eq!(skill.id, "sk-1");
        assert_eq!(skill.name, "MySkill");
        assert_eq!(skill.file_path, "/tmp/test-skill.md");
    }

    #[test]
    fn lookup_skill_db_not_found() {
        let conn = test_db();

        let result = lookup_skill_db(&conn, "nonexistent-id");

        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be NotFound")
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    // --- build_skill_prompt ---

    #[test]
    fn build_skill_prompt_string_input() {
        let skill_content = "# MySkill\n\nDo something useful.";

        let input = serde_json::Value::String("hello world".to_owned());

        let prompt = build_skill_prompt(skill_content, &input);

        assert!(prompt.contains(skill_content));
        assert!(prompt.contains("hello world"));
    }

    #[test]
    fn build_skill_prompt_object_input() {
        let skill_content = "# DataSkill\n\nProcess the data.";

        let input = serde_json::json!({"key": "value", "count": 42});

        let prompt = build_skill_prompt(skill_content, &input);

        assert!(prompt.contains(skill_content));
        assert!(prompt.contains("\"key\""));
        assert!(prompt.contains("\"value\""));
        assert!(prompt.contains("42"));
    }

    #[test]
    fn build_skill_prompt_preserves_skill_content() {
        let skill_content = "# Skill\n\nLine 1\nLine 2\n```yaml\nname: Test\n```";

        let input = serde_json::Value::String("input".to_owned());

        let prompt = build_skill_prompt(skill_content, &input);

        assert!(prompt.contains("# Skill"));
        assert!(prompt.contains("```yaml"));
    }

    // --- invoke_skill_db ---

    /// Fake LLM adapter that captures the prompt it receives.
    struct FakeLlmAdapter {
        captured_requests: Mutex<Vec<LlmRequest>>,
        response_content: String,
    }

    impl FakeLlmAdapter {
        fn new(response_content: &str) -> Self {
            Self {
                captured_requests: Mutex::new(Vec::new()),
                response_content: response_content.to_owned(),
            }
        }
    }

    #[async_trait]
    impl LlmAdapter for FakeLlmAdapter {
        fn id(&self) -> &'static str {
            "fake"
        }
        fn name(&self) -> &'static str {
            "Fake"
        }
        fn capabilities(&self) -> &LlmCapabilities {
            static CAPS: LlmCapabilities = LlmCapabilities {
                streaming: false,
                function_calling: false,
                max_context_tokens: 1000,
            };
            &CAPS
        }
        async fn execute_prompt(
            &self,
            request: &LlmRequest,
        ) -> Result<LlmResponse, crate::error::AppError> {
            self.captured_requests
                .lock()
                .unwrap_or_else(|e| panic!("lock: {e}"))
                .push(request.clone());
            Ok(LlmResponse {
                content: self.response_content.clone(),
                metadata: None,
            })
        }
    }

    #[tokio::test]
    async fn invoke_skill_not_found() {
        let conn = test_db();
        let adapter = FakeLlmAdapter::new("unused");

        let result = invoke_skill_db(
            &conn,
            "nonexistent-id",
            serde_json::json!("input"),
            &adapter,
        )
        .await;

        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be NotFound")
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn invoke_skill_file_read_error() {
        let conn = test_db();

        insert_test_skill(
            &conn,
            "sk-bad",
            "BadFileSkill",
            None,
            "/tmp/smartcrab_test_nonexistent_file.md",
            "pipeline",
            None,
        );
        let adapter = FakeLlmAdapter::new("unused");

        let result = invoke_skill_db(&conn, "sk-bad", serde_json::json!("input"), &adapter).await;

        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be an error")
        };
        assert!(
            matches!(err, AppError::Io(_)),
            "expected Io error, got: {err}"
        );
    }

    #[tokio::test]
    async fn invoke_skill_passes_prompt_to_adapter() {
        let conn = test_db();
        let dir = tempfile::tempdir().unwrap_or_else(|e| panic!("tempdir: {e}"));
        let skill_file = dir.path().join("test-skill.md");
        let skill_content = "# TestSkill\n\nDo the thing.\n```yaml\nname: Test\n```";
        std::fs::write(&skill_file, skill_content)
            .unwrap_or_else(|e| panic!("write skill file: {e}"));
        let file_path = skill_file
            .to_str()
            .unwrap_or_else(|| panic!("non-UTF-8 path"))
            .to_owned();

        insert_test_skill(
            &conn,
            "sk-ok",
            "TestSkill",
            Some("A test skill"),
            &file_path,
            "pipeline",
            Some("pl-1"),
        );
        let adapter = FakeLlmAdapter::new("skill output result");

        let result = invoke_skill_db(&conn, "sk-ok", serde_json::json!("do something"), &adapter)
            .await
            .unwrap_or_else(|e| panic!("should invoke: {e}"));

        assert_eq!(result.skill_id, "sk-ok");
        assert_eq!(result.skill_name, "TestSkill");
        assert_eq!(result.output, "skill output result");

        let captured = adapter
            .captured_requests
            .lock()
            .unwrap_or_else(|e| panic!("lock: {e}"));
        assert_eq!(captured.len(), 1);
        let prompt = &captured[0].prompt;
        assert!(prompt.contains("# TestSkill"));
        assert!(prompt.contains("do something"));
    }

    #[tokio::test]
    async fn invoke_skill_with_object_input() {
        let conn = test_db();
        let dir = tempfile::tempdir().unwrap_or_else(|e| panic!("tempdir: {e}"));
        let skill_file = dir.path().join("obj-skill.md");
        std::fs::write(&skill_file, "# ObjSkill\n\nProcess data.")
            .unwrap_or_else(|e| panic!("write skill file: {e}"));
        let file_path = skill_file
            .to_str()
            .unwrap_or_else(|| panic!("non-UTF-8 path"))
            .to_owned();

        insert_test_skill(
            &conn, "sk-obj", "ObjSkill", None, &file_path, "pipeline", None,
        );
        let adapter = FakeLlmAdapter::new("processed");

        let input = serde_json::json!({"topic": "rust", "level": 42});
        let result = invoke_skill_db(&conn, "sk-obj", input, &adapter)
            .await
            .unwrap_or_else(|e| panic!("should invoke: {e}"));

        assert_eq!(result.output, "processed");

        let captured = adapter
            .captured_requests
            .lock()
            .unwrap_or_else(|e| panic!("lock: {e}"));
        let prompt = &captured[0].prompt;
        assert!(prompt.contains("\"topic\""));
        assert!(prompt.contains("42"));
    }

    // --- SkillInvocationResult serialization ---

    #[test]
    fn skill_invocation_result_serializes() {
        let result = SkillInvocationResult {
            skill_id: "sk-1".to_owned(),
            skill_name: "MySkill".to_owned(),
            output: "some output".to_owned(),
        };

        let json = serde_json::to_string(&result)
            .unwrap_or_else(|e| panic!("serialize should succeed: {e}"));

        assert!(json.contains("sk-1"));
        assert!(json.contains("MySkill"));
        assert!(json.contains("some output"));
    }
}
