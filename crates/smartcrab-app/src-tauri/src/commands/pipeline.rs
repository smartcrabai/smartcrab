use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::bridge;
use crate::error::AppError;

/// State type wrapping an `SQLite` connection for Tauri's managed state.
pub type DbState = Mutex<Connection>;

/// Summary information about a pipeline (used in list views).
#[derive(Debug, Serialize)]
pub struct PipelineInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Full pipeline details including YAML content and settings.
#[derive(Debug, Serialize)]
pub struct PipelineDetail {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub yaml_content: String,
    pub max_loop_count: u32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of validating a pipeline YAML definition.
#[derive(Debug, Serialize)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub node_types: HashMap<String, String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Initialises the `pipelines` table if it does not already exist.
///
/// # Errors
///
/// Returns `AppError::Database` if the SQL statement fails.
pub fn init_db(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pipelines (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            yaml_content TEXT NOT NULL,
            max_loop_count INTEGER NOT NULL DEFAULT 10,
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )?;
    Ok(())
}

/// Lists all pipelines.
///
/// # Errors
///
/// Returns `AppError::Database` if the query fails or `AppError::Validation` if
/// the database lock cannot be acquired.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command injection requires owned State<T>"
)]
pub fn list_pipelines(db: State<'_, DbState>) -> Result<Vec<PipelineInfo>, AppError> {
    let conn = db
        .lock()
        .map_err(|e| AppError::Validation(format!("Failed to acquire database lock: {e}")))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, is_active, created_at, updated_at FROM pipelines ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PipelineInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            is_active: row.get::<_, i32>(3)? != 0,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    let mut pipelines = Vec::new();
    for row in rows {
        pipelines.push(row?);
    }
    Ok(pipelines)
}

/// Gets a single pipeline by ID.
///
/// # Errors
///
/// Returns `AppError::NotFound` if no pipeline with `id` exists, `AppError::Database`
/// on query failure, or `AppError::Validation` if the lock cannot be acquired.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command injection requires owned State<T>"
)]
pub fn get_pipeline(db: State<'_, DbState>, id: String) -> Result<PipelineDetail, AppError> {
    let conn = db
        .lock()
        .map_err(|e| AppError::Validation(format!("Failed to acquire database lock: {e}")))?;
    query_pipeline_by_id(&conn, &id)
}

/// Creates a new pipeline after validating the YAML content.
///
/// # Errors
///
/// Returns `AppError::Yaml` or `AppError::Validation` if `yaml_content` is
/// invalid, `AppError::Database` on insert failure, or `AppError::Validation`
/// if the lock cannot be acquired.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command injection requires owned State<T>"
)]
pub fn create_pipeline(
    db: State<'_, DbState>,
    name: String,
    description: Option<String>,
    yaml_content: String,
) -> Result<PipelineDetail, AppError> {
    bridge::validate_pipeline_yaml(&yaml_content)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = db
        .lock()
        .map_err(|e| AppError::Validation(format!("Failed to acquire database lock: {e}")))?;
    conn.execute(
        "INSERT INTO pipelines (id, name, description, yaml_content, max_loop_count, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 10, 1, ?5, ?6)",
        rusqlite::params![id, name, description, yaml_content, now, now],
    )?;

    query_pipeline_by_id(&conn, &id)
}

/// Updates an existing pipeline. Only provided fields are modified.
///
/// # Errors
///
/// Returns `AppError::NotFound` if no pipeline with `id` exists,
/// `AppError::Yaml` or `AppError::Validation` if the new `yaml_content` is
/// invalid, `AppError::Database` on update failure, or `AppError::Validation`
/// if the lock cannot be acquired.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command injection requires owned State<T>"
)]
pub fn update_pipeline(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    yaml_content: Option<String>,
) -> Result<PipelineDetail, AppError> {
    if let Some(ref yaml) = yaml_content {
        bridge::validate_pipeline_yaml(yaml)?;
    }

    let conn = db
        .lock()
        .map_err(|e| AppError::Validation(format!("Failed to acquire database lock: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339();

    // Build a single UPDATE statement with only the provided fields, using
    // positional parameters that match the runtime-determined set clause.
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    // ?1 is reserved for the WHERE id clause appended at the end.
    // Remaining params are appended here and referenced by their position.
    let mut param_idx: usize = 2;

    if let Some(n) = name {
        sets.push(format!("name = ?{param_idx}"));
        params.push(Box::new(n));
        param_idx += 1;
    }
    if let Some(d) = description {
        sets.push(format!("description = ?{param_idx}"));
        params.push(Box::new(d));
        param_idx += 1;
    }
    if let Some(y) = yaml_content {
        sets.push(format!("yaml_content = ?{param_idx}"));
        params.push(Box::new(y));
        param_idx += 1;
    }
    sets.push(format!("updated_at = ?{param_idx}"));
    params.push(Box::new(now));

    let sql = format!("UPDATE pipelines SET {} WHERE id = ?1", sets.join(", "));

    // ?1 = id; ?2 … ?N = set-clause values in the order they were pushed.
    let ordered: Vec<&dyn rusqlite::ToSql> = std::iter::once(&id as &dyn rusqlite::ToSql)
        .chain(params.iter().map(std::convert::AsRef::as_ref))
        .collect();

    let affected = conn.execute(&sql, ordered.as_slice())?;

    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "Pipeline with id '{id}' not found"
        )));
    }

    query_pipeline_by_id(&conn, &id)
}

/// Deletes a pipeline by ID.
///
/// # Errors
///
/// Returns `AppError::NotFound` if no pipeline with `id` exists,
/// `AppError::Database` on delete failure, or `AppError::Validation` if the
/// lock cannot be acquired.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command injection requires owned State<T>"
)]
pub fn delete_pipeline(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db
        .lock()
        .map_err(|e| AppError::Validation(format!("Failed to acquire database lock: {e}")))?;
    let affected = conn.execute("DELETE FROM pipelines WHERE id = ?1", rusqlite::params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "Pipeline with id '{id}' not found"
        )));
    }
    Ok(())
}

/// Validates pipeline YAML and returns structural analysis.
///
/// # Errors
///
/// Always returns `Ok`; parse errors are surfaced as `ValidationResult::errors`
/// rather than as a top-level `Err`. Only returns `Err` if an unexpected
/// internal error occurs.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command injection requires owned State<T>"
)]
pub fn validate_pipeline(yaml_content: String) -> Result<ValidationResult, AppError> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let (node_types, _edges) = match bridge::parse_pipeline_yaml(&yaml_content) {
        Ok(result) => result,
        Err(e) => {
            return Ok(ValidationResult {
                is_valid: false,
                node_types: HashMap::new(),
                errors: vec![e.to_string()],
                warnings: Vec::new(),
            });
        }
    };

    // Check structural validity
    if let Err(e) = bridge::validate_pipeline_yaml(&yaml_content) {
        errors.push(e.to_string());
    }

    // Add warnings for potential issues
    let output_count = node_types.values().filter(|t| *t == "output").count();
    if output_count == 0 {
        warnings.push("Pipeline has no output nodes".to_owned());
    }

    Ok(ValidationResult {
        is_valid: errors.is_empty(),
        node_types,
        errors,
        warnings,
    })
}

/// Helper: query a single pipeline by ID from the database.
fn query_pipeline_by_id(conn: &Connection, id: &str) -> Result<PipelineDetail, AppError> {
    conn.prepare(
        "SELECT id, name, description, yaml_content, max_loop_count, is_active, created_at, updated_at FROM pipelines WHERE id = ?1",
    )?
    .query_row(rusqlite::params![id], |row| {
        Ok(PipelineDetail {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            yaml_content: row.get(3)?,
            max_loop_count: row.get(4)?,
            is_active: row.get::<_, i32>(5)? != 0,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Pipeline with id '{id}' not found"))
        }
        other => AppError::Database(other),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap_or_else(|e| {
            panic!("Failed to open in-memory database: {e}");
        });
        init_db(&conn).unwrap_or_else(|e| {
            panic!("Failed to init database: {e}");
        });
        conn
    }

    fn valid_yaml() -> &'static str {
        r"
nodes:
  source: {}
  sink: {}
edges:
  - from: source
    to: sink
"
    }

    #[test]
    fn init_db_creates_table() {
        let conn = setup_test_db();
        let count: i32 = conn
            .prepare("SELECT COUNT(*) FROM pipelines")
            .and_then(|mut s| s.query_row([], |r| r.get(0)))
            .unwrap_or(-1);
        assert_eq!(count, 0);
    }

    #[test]
    fn crud_create_and_read() {
        let conn = setup_test_db();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let yaml = valid_yaml();

        conn.execute(
            "INSERT INTO pipelines (id, name, description, yaml_content, max_loop_count, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 10, 1, ?5, ?6)",
            rusqlite::params![id, "Test Pipeline", None::<String>, yaml, now, now],
        )
        .unwrap_or_else(|e| panic!("Insert failed: {e}"));

        let pipeline = query_pipeline_by_id(&conn, &id);
        assert!(pipeline.is_ok());
        let pipeline = pipeline.unwrap_or_else(|e| panic!("Query failed: {e}"));
        assert_eq!(pipeline.name, "Test Pipeline");
        assert_eq!(pipeline.yaml_content, yaml);
        assert!(pipeline.is_active);
    }

    #[test]
    fn crud_not_found() {
        let conn = setup_test_db();
        let Err(err) = query_pipeline_by_id(&conn, "nonexistent") else {
            panic!("expected NotFound error")
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn crud_update_fields() {
        let conn = setup_test_db();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO pipelines (id, name, description, yaml_content, max_loop_count, is_active, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, 10, 1, ?4, ?5)",
            rusqlite::params![id, "Original", valid_yaml(), now, now],
        )
        .unwrap_or_else(|e| panic!("Insert failed: {e}"));

        let updated_now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE pipelines SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params!["Updated", updated_now, id],
        )
        .unwrap_or_else(|e| panic!("Update failed: {e}"));

        let pipeline =
            query_pipeline_by_id(&conn, &id).unwrap_or_else(|e| panic!("Query failed: {e}"));
        assert_eq!(pipeline.name, "Updated");
    }

    #[test]
    fn crud_delete() {
        let conn = setup_test_db();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO pipelines (id, name, description, yaml_content, max_loop_count, is_active, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, 10, 1, ?4, ?5)",
            rusqlite::params![id, "ToDelete", valid_yaml(), now, now],
        )
        .unwrap_or_else(|e| panic!("Insert failed: {e}"));

        let affected = conn
            .execute("DELETE FROM pipelines WHERE id = ?1", rusqlite::params![id])
            .unwrap_or_else(|e| panic!("Delete failed: {e}"));
        assert_eq!(affected, 1);

        let result = query_pipeline_by_id(&conn, &id);
        assert!(matches!(result, Err(AppError::NotFound(_))));
    }

    #[test]
    fn delete_nonexistent_returns_zero_affected() {
        let conn = setup_test_db();
        let affected = conn
            .execute(
                "DELETE FROM pipelines WHERE id = ?1",
                rusqlite::params!["nonexistent"],
            )
            .unwrap_or_else(|e| panic!("Delete failed: {e}"));
        assert_eq!(affected, 0);
    }

    #[test]
    fn validate_pipeline_valid() {
        let yaml = valid_yaml().to_owned();
        let result = validate_pipeline(yaml);
        assert!(result.is_ok());
        let result = result.unwrap_or_else(|e| panic!("Validation failed: {e}"));
        assert!(result.is_valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn validate_pipeline_invalid_yaml() {
        let result = validate_pipeline("not: [valid: yaml:".to_owned());
        assert!(result.is_ok());
        let result = result.unwrap_or_else(|e| panic!("Validation failed: {e}"));
        assert!(!result.is_valid);
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn validate_pipeline_detects_node_types() {
        let yaml = r"
nodes:
  a: {}
  b: {}
  c: {}
edges:
  - from: a
    to: b
  - from: b
    to: c
"
        .to_owned();
        let result = validate_pipeline(yaml);
        assert!(result.is_ok());
        let result = result.unwrap_or_else(|e| panic!("Validation failed: {e}"));
        assert!(result.is_valid);
        assert_eq!(
            result.node_types.get("a").map(String::as_str),
            Some("input")
        );
        assert_eq!(
            result.node_types.get("b").map(String::as_str),
            Some("hidden")
        );
        assert_eq!(
            result.node_types.get("c").map(String::as_str),
            Some("output")
        );
    }

    #[test]
    fn list_pipelines_returns_inserted_rows() {
        let conn = setup_test_db();
        let now = chrono::Utc::now().to_rfc3339();

        for i in 0..3 {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO pipelines (id, name, description, yaml_content, max_loop_count, is_active, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, 10, 1, ?4, ?5)",
                rusqlite::params![id, format!("Pipeline {i}"), valid_yaml(), now, now],
            )
            .unwrap_or_else(|e| panic!("Insert failed: {e}"));
        }

        let mut stmt = conn
            .prepare("SELECT id, name, description, is_active, created_at, updated_at FROM pipelines ORDER BY updated_at DESC")
            .unwrap_or_else(|e| panic!("Prepare failed: {e}"));
        let rows: Vec<PipelineInfo> = stmt
            .query_map([], |row| {
                Ok(PipelineInfo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    is_active: row.get::<_, i32>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .unwrap_or_else(|e| panic!("Query failed: {e}"))
            .filter_map(std::result::Result::ok)
            .collect();
        assert_eq!(rows.len(), 3);
    }
}
