use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info};

use crate::db::DbState;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Event types emitted to the frontend
// ---------------------------------------------------------------------------

/// Event payload emitted to the frontend during pipeline execution.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExecutionEvent {
    pub execution_id: String,
    pub event_type: String,
    pub node_id: Option<String>,
    pub node_name: Option<String>,
    pub data: Option<serde_json::Value>,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Response structs
// ---------------------------------------------------------------------------

/// Summary of a pipeline execution (list view).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExecutionSummary {
    pub id: String,
    pub pipeline_id: String,
    pub pipeline_name: String,
    pub trigger_type: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
}

/// Detailed view of a single execution with node runs and logs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExecutionDetail {
    pub id: String,
    pub pipeline_id: String,
    pub trigger_type: String,
    pub trigger_data: Option<serde_json::Value>,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub node_executions: Vec<NodeExecution>,
    pub logs: Vec<ExecutionLog>,
}

/// Record of a single node's execution within a pipeline run.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeExecution {
    pub id: String,
    pub node_id: String,
    pub node_name: String,
    pub iteration: u32,
    pub status: String,
    pub input_data: Option<serde_json::Value>,
    pub output_data: Option<serde_json::Value>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

/// A single log line produced during execution.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExecutionLog {
    pub id: i64,
    pub node_id: Option<String>,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Pipeline YAML model (simplified)
// ---------------------------------------------------------------------------

/// Simplified pipeline definition parsed from YAML stored in `SQLite`.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct PipelineDefinition {
    name: String,
    #[serde(default)]
    nodes: Vec<PipelineNode>,
    #[serde(default)]
    edges: Vec<PipelineEdge>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PipelineNode {
    id: String,
    name: String,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    params: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PipelineEdge {
    from: String,
    to: EdgeTarget,
    #[serde(default)]
    condition: Option<ConditionSpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum EdgeTarget {
    Single(String),
    Parallel(Vec<String>),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ConditionSpec {
    field: String,
    rules: HashMap<String, String>,
}

// ---------------------------------------------------------------------------
// Loop guard
// ---------------------------------------------------------------------------

/// Prevents infinite loops by tracking per-node iteration counts.
struct LoopGuard {
    counts: HashMap<String, u32>,
    max_iterations: u32,
}

impl LoopGuard {
    fn new(max_iterations: u32) -> Self {
        Self {
            counts: HashMap::new(),
            max_iterations,
        }
    }

    /// Increment the count for `node_id` and return the new count.
    /// Returns `Err` if the limit is exceeded.
    fn visit(&mut self, node_id: &str) -> Result<u32, AppError> {
        let count = self.counts.entry(node_id.to_owned()).or_insert(0);
        *count += 1;
        if *count > self.max_iterations {
            return Err(AppError::Other(format!(
                "node `{node_id}` exceeded max iterations ({max})",
                max = self.max_iterations,
            )));
        }
        Ok(*count)
    }
}

// ---------------------------------------------------------------------------
// Helper: emit event
// ---------------------------------------------------------------------------

fn emit_event(app: &AppHandle, event: &ExecutionEvent) {
    if let Err(e) = app.emit("execution-event", event) {
        error!(error = %e, "failed to emit execution event");
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start executing a pipeline.
///
/// Returns the `execution_id` immediately. Actual execution happens in a
/// background task that emits `ExecutionEvent`s via Tauri events.
///
/// # Errors
///
/// Returns [`AppError`] if the pipeline is not found or database access fails.
#[tauri::command]
pub async fn execute_pipeline(
    app: AppHandle,
    db: State<'_, DbState>,
    pipeline_id: String,
    trigger_data: Option<serde_json::Value>,
) -> Result<String, AppError> {
    let execution_id = uuid::Uuid::new_v4().to_string();

    let (pipeline_name, yaml_def) = {
        let conn = db.lock()?;
        let mut stmt = conn.prepare("SELECT name, yaml_content FROM pipelines WHERE id = ?1")?;
        let row = stmt.query_row([&pipeline_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        match row {
            Ok(r) => r,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(AppError::NotFound(format!("pipeline '{pipeline_id}'")));
            }
            Err(e) => return Err(AppError::Database(e)),
        }
    };
    let trigger_type = "manual";

    {
        let trigger_json = trigger_data
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let conn = db.lock()?;
        conn.execute(
            "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, trigger_data, status, started_at) VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
            rusqlite::params![execution_id, pipeline_id, trigger_type, trigger_json, now_iso()],
        )?;
    }

    let started_event = ExecutionEvent {
        execution_id: execution_id.clone(),
        event_type: "execution_started".to_owned(),
        node_id: None,
        node_name: Some(pipeline_name.clone()),
        data: trigger_data.clone(),
        timestamp: now_iso(),
    };
    emit_event(&app, &started_event);

    let exec_id = execution_id.clone();
    let db_inner = {
        // A new connection is needed because `State<'_>` cannot be moved into
        // the spawned task — we extract the db path here before spawning.
        let conn = db.lock()?;

        conn.path().map(|p| std::path::Path::new(p).to_path_buf())
    };

    tokio::spawn(async move {
        let result = run_pipeline_async(
            &app,
            &exec_id,
            &pipeline_id,
            &yaml_def,
            trigger_data.as_ref(),
            db_inner.as_deref(),
        )
        .await;

        if let Err(e) = &result {
            error!(execution_id = %exec_id, error = %e, "pipeline execution failed");
        }
    });

    Ok(execution_id)
}

/// Cancel a running execution.
///
/// # Errors
///
/// Returns [`AppError`] if the execution is not found or database access fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn cancel_execution(db: State<'_, DbState>, execution_id: String) -> Result<(), AppError> {
    let conn = db.lock()?;
    let updated = conn.execute(
        "UPDATE pipeline_executions SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
        rusqlite::params![now_iso(), execution_id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("execution '{execution_id}'")));
    }
    Ok(())
}

/// Get a list of past executions.
///
/// # Errors
///
/// Returns [`AppError`] if database access fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn get_execution_history(
    db: State<'_, DbState>,
    pipeline_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ExecutionSummary>, AppError> {
    let conn = db.lock()?;
    let limit = limit.unwrap_or(50);

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(ref pid) =
        pipeline_id
    {
        (
            "SELECT e.id, e.pipeline_id, COALESCE(p.name, ''), e.trigger_type, e.status, e.started_at, e.completed_at \
             FROM pipeline_executions e LEFT JOIN pipelines p ON e.pipeline_id = p.id \
             WHERE e.pipeline_id = ?1 ORDER BY e.started_at DESC LIMIT ?2"
                .to_owned(),
            vec![
                Box::new(pid.clone()) as Box<dyn rusqlite::types::ToSql>,
                Box::new(limit),
            ],
        )
    } else {
        (
            "SELECT e.id, e.pipeline_id, COALESCE(p.name, ''), e.trigger_type, e.status, e.started_at, e.completed_at \
             FROM pipeline_executions e LEFT JOIN pipelines p ON e.pipeline_id = p.id \
             ORDER BY e.started_at DESC LIMIT ?1"
                .to_owned(),
            vec![Box::new(limit) as Box<dyn rusqlite::types::ToSql>],
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
        Ok(ExecutionSummary {
            id: row.get(0)?,
            pipeline_id: row.get(1)?,
            pipeline_name: row.get(2)?,
            trigger_type: row.get(3)?,
            status: row.get(4)?,
            started_at: row.get(5)?,
            completed_at: row.get(6)?,
        })
    })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// Get full details of a single execution.
///
/// # Errors
///
/// Returns [`AppError`] if the execution is not found or database access fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
#[expect(
    clippy::too_many_lines,
    reason = "large query result assembly; extracting helpers would obscure the DB schema"
)]
pub fn get_execution_detail(
    db: State<'_, DbState>,
    execution_id: String,
) -> Result<ExecutionDetail, AppError> {
    let conn = db.lock()?;

    // Fetch execution
    let exec = conn.query_row(
        "SELECT id, pipeline_id, trigger_type, trigger_data, status, started_at, completed_at, error_message \
         FROM pipeline_executions WHERE id = ?1",
        [&execution_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        },
    );
    let (
        id,
        pipeline_id,
        trigger_type,
        trigger_data_raw,
        status,
        started_at,
        completed_at,
        error_message,
    ) = match exec {
        Ok(r) => r,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(AppError::NotFound(format!("execution '{execution_id}'")));
        }
        Err(e) => return Err(AppError::Database(e)),
    };

    let trigger_data = trigger_data_raw
        .as_deref()
        .map(serde_json::from_str)
        .transpose()?;

    // Fetch node executions
    let mut stmt = conn.prepare(
        "SELECT id, node_id, node_name, iteration, status, input_data, output_data, started_at, completed_at, error_message \
         FROM node_executions WHERE execution_id = ?1 ORDER BY started_at ASC",
    )?;
    let node_rows = stmt.query_map([&execution_id], |row| {
        Ok(NodeExecutionRow {
            id: row.get(0)?,
            node_id: row.get(1)?,
            node_name: row.get(2)?,
            iteration: row.get(3)?,
            status: row.get(4)?,
            input_data: row.get(5)?,
            output_data: row.get(6)?,
            started_at: row.get(7)?,
            completed_at: row.get(8)?,
            error_message: row.get(9)?,
        })
    })?;

    let mut node_executions = Vec::new();
    for row in node_rows {
        let r = row?;
        node_executions.push(NodeExecution {
            id: r.id,
            node_id: r.node_id,
            node_name: r.node_name,
            iteration: r.iteration,
            status: r.status,
            input_data: r
                .input_data
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?,
            output_data: r
                .output_data
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?,
            started_at: r.started_at,
            completed_at: r.completed_at,
            error_message: r.error_message,
        });
    }

    // Fetch logs
    let mut stmt = conn.prepare(
        "SELECT id, node_id, level, message, timestamp FROM execution_logs WHERE execution_id = ?1 ORDER BY id ASC",
    )?;
    let log_rows = stmt.query_map([&execution_id], |row| {
        Ok(ExecutionLog {
            id: row.get(0)?,
            node_id: row.get(1)?,
            level: row.get(2)?,
            message: row.get(3)?,
            timestamp: row.get(4)?,
        })
    })?;

    let mut logs = Vec::new();
    for row in log_rows {
        logs.push(row?);
    }

    Ok(ExecutionDetail {
        id,
        pipeline_id,
        trigger_type,
        trigger_data,
        status,
        started_at,
        completed_at,
        error_message,
        node_executions,
        logs,
    })
}

// ---------------------------------------------------------------------------
// Internal row helper (avoids tuple soup for node_executions query)
// ---------------------------------------------------------------------------

struct NodeExecutionRow {
    id: String,
    node_id: String,
    node_name: String,
    iteration: u32,
    status: String,
    input_data: Option<String>,
    output_data: Option<String>,
    started_at: String,
    completed_at: Option<String>,
    error_message: Option<String>,
}

// ---------------------------------------------------------------------------
// Pipeline runner (background async task)
// ---------------------------------------------------------------------------

/// Determine topological execution order from edges.
fn topological_order(nodes: &[PipelineNode], edges: &[PipelineEdge]) -> Vec<String> {
    let node_ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let mut in_degree: HashMap<String, usize> = node_ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

    for edge in edges {
        let targets = match &edge.to {
            EdgeTarget::Single(t) => vec![t.clone()],
            EdgeTarget::Parallel(ts) => ts.clone(),
        };
        for target in targets {
            adjacency
                .entry(edge.from.clone())
                .or_default()
                .push(target.clone());
            *in_degree.entry(target).or_insert(0) += 1;
        }
    }

    // Use a sorted Vec as a priority queue for deterministic ordering.
    // New zero-in-degree nodes are inserted in sorted position to keep the
    // invariant without a full re-sort on every insertion.
    let mut queue: Vec<String> = in_degree
        .iter()
        .filter(|&(_, deg)| *deg == 0)
        .map(|(id, _)| id.clone())
        .collect();
    queue.sort();
    let mut result = Vec::new();

    while !queue.is_empty() {
        let node = queue.remove(0);
        result.push(node.clone());
        if let Some(neighbors) = adjacency.get(&node) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        // Insert in sorted position rather than push + full sort.
                        let pos = queue.partition_point(|x| x < neighbor);
                        queue.insert(pos, neighbor.clone());
                    }
                }
            }
        }
    }

    result
}

/// Find outgoing edges from a given node.
fn outgoing_edges<'a>(from: &str, edges: &'a [PipelineEdge]) -> Vec<&'a PipelineEdge> {
    edges.iter().filter(|e| e.from == from).collect()
}

/// Evaluate a condition spec against an output value and return the next node id.
fn evaluate_condition(condition: &ConditionSpec, output: &serde_json::Value) -> Option<String> {
    let field_value = output.get(&condition.field)?.as_str()?;
    condition.rules.get(field_value).cloned()
}

/// Simulate node execution, producing a simple output JSON.
fn simulate_node_execution(node: &PipelineNode, input: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "node_id": node.id,
        "node_name": node.name,
        "action": node.action,
        "input": input,
        "status": "ok"
    })
}

/// Run the pipeline nodes in topological order with event emission and DB recording.
#[expect(
    clippy::too_many_lines,
    reason = "pipeline runner is inherently stateful; sub-functions would require excessive parameter threading"
)]
#[expect(
    clippy::unused_async,
    reason = "reserved for future real async node execution (HTTP/LLM calls)"
)]
async fn run_pipeline_async(
    app: &AppHandle,
    execution_id: &str,
    pipeline_id: &str,
    yaml_def: &str,
    trigger_data: Option<&serde_json::Value>,
    db_path: Option<&std::path::Path>,
) -> Result<(), AppError> {
    let definition: PipelineDefinition = serde_json::from_str(yaml_def)
        .map_err(|e| AppError::Other(format!("failed to parse pipeline definition: {e}")))?;

    let order = topological_order(&definition.nodes, &definition.edges);
    let node_map: HashMap<String, &PipelineNode> =
        definition.nodes.iter().map(|n| (n.id.clone(), n)).collect();

    let mut loop_guard = LoopGuard::new(100);
    let mut outputs: HashMap<String, serde_json::Value> = HashMap::new();
    let initial_input = trigger_data.cloned().unwrap_or(serde_json::Value::Null);

    // Open a separate connection for the background task
    let conn = if let Some(path) = db_path {
        Some(rusqlite::Connection::open(path)?)
    } else {
        None
    };

    let mut final_status = "completed";
    let mut error_message: Option<String> = None;

    for node_id in &order {
        let Some(node) = node_map.get(node_id) else {
            continue;
        };

        let iteration = loop_guard.visit(node_id).inspect_err(|e| {
            final_status = "failed";
            error_message = Some(e.to_string());
        })?;

        // Determine input
        let input = outputs
            .get(node_id)
            .cloned()
            .unwrap_or_else(|| initial_input.clone());

        // Emit node_started
        let node_exec_id = uuid::Uuid::new_v4().to_string();
        let started_at = now_iso();
        emit_event(
            app,
            &ExecutionEvent {
                execution_id: execution_id.to_owned(),
                event_type: "node_started".to_owned(),
                node_id: Some(node_id.clone()),
                node_name: Some(node.name.clone()),
                data: Some(input.clone()),
                timestamp: started_at.clone(),
            },
        );

        // Record node execution start
        if let Some(ref c) = conn {
            let input_json = serde_json::to_string(&input).ok();
            let _ = c.execute(
                "INSERT INTO node_executions (id, execution_id, node_id, node_name, iteration, status, input_data, started_at) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7)",
                rusqlite::params![node_exec_id, execution_id, node_id, node.name, iteration, input_json, started_at],
            );
        }

        // Simulate execution
        let output = simulate_node_execution(node, &input);
        let completed_at = now_iso();

        // Emit node_completed
        emit_event(
            app,
            &ExecutionEvent {
                execution_id: execution_id.to_owned(),
                event_type: "node_completed".to_owned(),
                node_id: Some(node_id.clone()),
                node_name: Some(node.name.clone()),
                data: Some(output.clone()),
                timestamp: completed_at.clone(),
            },
        );

        // Update node execution record
        if let Some(ref c) = conn {
            let output_json = serde_json::to_string(&output).ok();
            let _ = c.execute(
                "UPDATE node_executions SET status = 'completed', output_data = ?1, completed_at = ?2 WHERE id = ?3",
                rusqlite::params![output_json, completed_at, node_exec_id],
            );
        }

        // Log
        if let Some(ref c) = conn {
            let _ = c.execute(
                "INSERT INTO execution_logs (execution_id, node_id, level, message, timestamp) VALUES (?1, ?2, 'info', ?3, ?4)",
                rusqlite::params![execution_id, node_id, format!("node '{}' completed", node.name), completed_at],
            );
        }

        // Route to next nodes
        let outgoing = outgoing_edges(node_id, &definition.edges);
        for edge in outgoing {
            match &edge.to {
                EdgeTarget::Single(target) => {
                    if let Some(ref cond) = edge.condition {
                        if let Some(next) = evaluate_condition(cond, &output) {
                            outputs.insert(next, output.clone());
                        }
                    } else {
                        outputs.insert(target.clone(), output.clone());
                    }
                }
                EdgeTarget::Parallel(targets) => {
                    for target in targets {
                        outputs.insert(target.clone(), output.clone());
                    }
                }
            }
        }
    }

    // Update execution record as completed
    if let Some(ref c) = conn {
        let _ = c.execute(
            "UPDATE pipeline_executions SET status = ?1, completed_at = ?2, error_message = ?3 WHERE id = ?4",
            rusqlite::params![final_status, now_iso(), error_message, execution_id],
        );
    }

    // Emit execution_completed
    emit_event(
        app,
        &ExecutionEvent {
            execution_id: execution_id.to_owned(),
            event_type: "execution_completed".to_owned(),
            node_id: None,
            node_name: None,
            data: None,
            timestamp: now_iso(),
        },
    );

    info!(execution_id = %execution_id, pipeline_id = %pipeline_id, "pipeline execution completed");

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbState;

    #[test]
    fn execution_event_serialization() {
        let event = ExecutionEvent {
            execution_id: "exec-1".to_owned(),
            event_type: "node_started".to_owned(),
            node_id: Some("node-a".to_owned()),
            node_name: Some("Fetch Data".to_owned()),
            data: Some(serde_json::json!({"url": "https://example.com"})),
            timestamp: "2026-01-01T00:00:00Z".to_owned(),
        };
        let json = serde_json::to_string(&event);
        assert!(json.is_ok());
        let json_str = json.ok().unwrap_or_default();
        assert!(json_str.contains("exec-1"));
        assert!(json_str.contains("node_started"));
        assert!(json_str.contains("Fetch Data"));
    }

    #[test]
    fn execution_event_round_trip() {
        let event = ExecutionEvent {
            execution_id: "exec-2".to_owned(),
            event_type: "execution_completed".to_owned(),
            node_id: None,
            node_name: None,
            data: None,
            timestamp: "2026-01-01T12:00:00Z".to_owned(),
        };
        let json = serde_json::to_string(&event);
        assert!(json.is_ok());
        let json_str = json.ok().unwrap_or_default();
        let parsed: Result<ExecutionEvent, _> = serde_json::from_str(&json_str);
        assert!(parsed.is_ok());
        let parsed = parsed.ok().unwrap_or_else(|| event.clone());
        assert_eq!(parsed.execution_id, "exec-2");
        assert_eq!(parsed.event_type, "execution_completed");
        assert!(parsed.node_id.is_none());
    }

    #[test]
    fn execution_summary_serialization() {
        let summary = ExecutionSummary {
            id: "e-1".to_owned(),
            pipeline_id: "p-1".to_owned(),
            pipeline_name: "Test Pipeline".to_owned(),
            trigger_type: "manual".to_owned(),
            status: "completed".to_owned(),
            started_at: "2026-01-01T00:00:00Z".to_owned(),
            completed_at: Some("2026-01-01T00:01:00Z".to_owned()),
        };
        let json = serde_json::to_value(&summary);
        assert!(json.is_ok());
    }

    fn seed_pipeline(db: &DbState, pipeline_id: &str, name: &str) {
        let conn = db.conn.lock().ok();
        if let Some(conn) = conn.as_ref() {
            let _ = conn.execute(
                "INSERT INTO pipelines (id, name, yaml_content, created_at, updated_at) VALUES (?1, ?2, '{}', datetime('now'), datetime('now'))",
                rusqlite::params![pipeline_id, name],
            );
        }
    }

    fn seed_execution(db: &DbState, execution_id: &str, pipeline_id: &str, status: &str) {
        let conn = db.conn.lock().ok();
        if let Some(conn) = conn.as_ref() {
            let _ = conn.execute(
                "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, status, started_at) VALUES (?1, ?2, 'manual', ?3, datetime('now'))",
                rusqlite::params![execution_id, pipeline_id, status],
            );
        }
    }

    fn seed_node_execution(
        db: &DbState,
        ne_id: &str,
        execution_id: &str,
        node_id: &str,
        node_name: &str,
    ) {
        let conn = db.conn.lock().ok();
        if let Some(conn) = conn.as_ref() {
            let _ = conn.execute(
                "INSERT INTO node_executions (id, execution_id, node_id, node_name, iteration, status, started_at) VALUES (?1, ?2, ?3, ?4, 1, 'completed', datetime('now'))",
                rusqlite::params![ne_id, execution_id, node_id, node_name],
            );
        }
    }

    fn seed_execution_log(db: &DbState, execution_id: &str, node_id: Option<&str>, message: &str) {
        let conn = db.conn.lock().ok();
        if let Some(conn) = conn.as_ref() {
            let _ = conn.execute(
                "INSERT INTO execution_logs (execution_id, node_id, level, message, timestamp) VALUES (?1, ?2, 'info', ?3, datetime('now'))",
                rusqlite::params![execution_id, node_id, message],
            );
        }
    }

    #[test]
    fn get_execution_history_empty() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
        let db = db.ok();
        assert!(db.is_some());
        let db = db.as_ref();
        // We cannot use the tauri State wrapper in tests, so test via raw DB logic
        let conn = db.and_then(|d| d.conn.lock().ok());
        assert!(conn.is_some());
        let conn = conn.as_ref();

        let count: i64 = conn
            .and_then(|c| {
                c.query_row("SELECT COUNT(*) FROM pipeline_executions", [], |row| {
                    row.get(0)
                })
                .ok()
            })
            .unwrap_or(-1);
        assert_eq!(count, 0);
    }

    #[test]
    fn get_execution_history_with_data() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
        let db = db.ok();
        assert!(db.is_some());
        let db_ref = db.as_ref();
        if let Some(db_ref) = db_ref {
            seed_pipeline(db_ref, "p-1", "Pipeline One");
            seed_execution(db_ref, "e-1", "p-1", "completed");
            seed_execution(db_ref, "e-2", "p-1", "failed");

            let conn = db_ref.conn.lock().ok();
            assert!(conn.is_some());
            if let Some(conn) = conn.as_ref() {
                let mut stmt = conn
                    .prepare(
                        "SELECT e.id, e.pipeline_id, COALESCE(p.name, ''), e.trigger_type, e.status, e.started_at, e.completed_at \
                         FROM pipeline_executions e LEFT JOIN pipelines p ON e.pipeline_id = p.id \
                         ORDER BY e.started_at DESC LIMIT 50",
                    )
                    .ok();
                if let Some(ref mut stmt) = stmt {
                    let rows: Vec<ExecutionSummary> = stmt
                        .query_map([], |row| {
                            Ok(ExecutionSummary {
                                id: row.get(0)?,
                                pipeline_id: row.get(1)?,
                                pipeline_name: row.get(2)?,
                                trigger_type: row.get(3)?,
                                status: row.get(4)?,
                                started_at: row.get(5)?,
                                completed_at: row.get(6)?,
                            })
                        })
                        .ok()
                        .into_iter()
                        .flat_map(|r| r.filter_map(Result::ok))
                        .collect();
                    assert_eq!(rows.len(), 2);
                    assert!(rows.iter().any(|r| r.status == "completed"));
                    assert!(rows.iter().any(|r| r.status == "failed"));
                }
            }
        }
    }

    #[test]
    fn get_execution_detail_with_nodes_and_logs() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
        let db = db.ok();
        assert!(db.is_some());
        if let Some(ref db_ref) = db {
            seed_pipeline(db_ref, "p-1", "My Pipeline");
            seed_execution(db_ref, "e-1", "p-1", "completed");
            seed_node_execution(db_ref, "ne-1", "e-1", "node-a", "Fetch");
            seed_node_execution(db_ref, "ne-2", "e-1", "node-b", "Transform");
            seed_execution_log(db_ref, "e-1", Some("node-a"), "Fetched data");
            seed_execution_log(db_ref, "e-1", None, "Pipeline done");

            let conn = db_ref.conn.lock().ok();
            assert!(conn.is_some());
            if let Some(conn) = conn.as_ref() {
                // Verify node executions
                let ne_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM node_executions WHERE execution_id = 'e-1'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                assert_eq!(ne_count, 2);

                // Verify logs
                let log_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM execution_logs WHERE execution_id = 'e-1'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                assert_eq!(log_count, 2);
            }
        }
    }

    #[test]
    fn topological_order_simple_chain() {
        let nodes = vec![
            PipelineNode {
                id: "a".to_owned(),
                name: "A".to_owned(),
                action: None,
                params: None,
            },
            PipelineNode {
                id: "b".to_owned(),
                name: "B".to_owned(),
                action: None,
                params: None,
            },
            PipelineNode {
                id: "c".to_owned(),
                name: "C".to_owned(),
                action: None,
                params: None,
            },
        ];
        let edges = vec![
            PipelineEdge {
                from: "a".to_owned(),
                to: EdgeTarget::Single("b".to_owned()),
                condition: None,
            },
            PipelineEdge {
                from: "b".to_owned(),
                to: EdgeTarget::Single("c".to_owned()),
                condition: None,
            },
        ];
        let order = topological_order(&nodes, &edges);
        assert_eq!(order, vec!["a", "b", "c"]);
    }

    #[test]
    fn topological_order_parallel_dispatch() {
        let nodes = vec![
            PipelineNode {
                id: "start".to_owned(),
                name: "Start".to_owned(),
                action: None,
                params: None,
            },
            PipelineNode {
                id: "left".to_owned(),
                name: "Left".to_owned(),
                action: None,
                params: None,
            },
            PipelineNode {
                id: "right".to_owned(),
                name: "Right".to_owned(),
                action: None,
                params: None,
            },
        ];
        let edges = vec![PipelineEdge {
            from: "start".to_owned(),
            to: EdgeTarget::Parallel(vec!["left".to_owned(), "right".to_owned()]),
            condition: None,
        }];
        let order = topological_order(&nodes, &edges);
        assert_eq!(order[0], "start");
        // left and right should both appear after start
        assert!(order.contains(&"left".to_owned()));
        assert!(order.contains(&"right".to_owned()));
    }

    #[test]
    fn loop_guard_prevents_infinite_loop() {
        let mut guard = LoopGuard::new(3);
        assert!(guard.visit("n1").is_ok());
        assert!(guard.visit("n1").is_ok());
        assert!(guard.visit("n1").is_ok());
        assert!(guard.visit("n1").is_err());
    }

    #[test]
    fn loop_guard_tracks_separate_nodes() {
        let mut guard = LoopGuard::new(2);
        assert!(guard.visit("a").is_ok());
        assert!(guard.visit("b").is_ok());
        assert!(guard.visit("a").is_ok());
        assert!(guard.visit("b").is_ok());
        assert!(guard.visit("a").is_err());
        assert!(guard.visit("b").is_err());
    }

    #[test]
    fn evaluate_condition_matches_rule() {
        let condition = ConditionSpec {
            field: "status".to_owned(),
            rules: HashMap::from([
                ("ok".to_owned(), "next-ok".to_owned()),
                ("err".to_owned(), "next-err".to_owned()),
            ]),
        };
        let output = serde_json::json!({"status": "ok", "data": 42});
        let next = evaluate_condition(&condition, &output);
        assert_eq!(next, Some("next-ok".to_owned()));
    }

    #[test]
    fn evaluate_condition_no_match() {
        let condition = ConditionSpec {
            field: "status".to_owned(),
            rules: HashMap::from([("ok".to_owned(), "next-ok".to_owned())]),
        };
        let output = serde_json::json!({"status": "unknown"});
        let next = evaluate_condition(&condition, &output);
        assert!(next.is_none());
    }

    #[test]
    fn evaluate_condition_missing_field() {
        let condition = ConditionSpec {
            field: "missing".to_owned(),
            rules: HashMap::from([("ok".to_owned(), "next-ok".to_owned())]),
        };
        let output = serde_json::json!({"status": "ok"});
        let next = evaluate_condition(&condition, &output);
        assert!(next.is_none());
    }

    #[test]
    fn simulate_node_produces_output() {
        let node = PipelineNode {
            id: "n1".to_owned(),
            name: "Test Node".to_owned(),
            action: Some("http".to_owned()),
            params: None,
        };
        let input = serde_json::json!({"key": "value"});
        let output = simulate_node_execution(&node, &input);
        assert_eq!(output["node_id"], "n1");
        assert_eq!(output["status"], "ok");
    }

    #[test]
    fn cancel_execution_not_found() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
        if let Ok(ref db_ref) = db {
            let conn = db_ref.conn.lock().ok();
            if let Some(conn) = conn.as_ref() {
                let updated = conn.execute(
                    "UPDATE pipeline_executions SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
                    rusqlite::params![now_iso(), "nonexistent"],
                );
                assert!(updated.is_ok());
                assert_eq!(updated.unwrap_or(1), 0);
            }
        }
    }

    #[test]
    fn cancel_execution_success() {
        let db = DbState::open_in_memory();
        assert!(db.is_ok());
        if let Ok(ref db_ref) = db {
            seed_pipeline(db_ref, "p-1", "Test");
            seed_execution(db_ref, "e-1", "p-1", "running");

            let conn = db_ref.conn.lock().ok();
            if let Some(conn) = conn.as_ref() {
                let updated = conn.execute(
                    "UPDATE pipeline_executions SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
                    rusqlite::params![now_iso(), "e-1"],
                );
                assert!(updated.is_ok());
                assert_eq!(updated.unwrap_or(0), 1);

                // Verify status changed
                let status: Option<String> = conn
                    .query_row(
                        "SELECT status FROM pipeline_executions WHERE id = 'e-1'",
                        [],
                        |row| row.get(0),
                    )
                    .ok();
                assert_eq!(status.as_deref(), Some("cancelled"));
            }
        }
    }
}
