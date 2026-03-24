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
mod tests {
    use super::*;
    use crate::commands::test_db;

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
}
