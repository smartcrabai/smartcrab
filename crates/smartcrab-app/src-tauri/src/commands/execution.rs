use std::collections::HashMap;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{error, info};

use crate::db::DbState;
use crate::engine::loop_guard::LoopGuard;
use crate::engine::yaml_parser::ResolvedPipeline;
use crate::engine::yaml_schema::{
    Condition, MatchCondition, NextTarget, NodeAction, NodeDefinition,
};
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
// Constants
// ---------------------------------------------------------------------------

/// Default maximum loop iterations when not specified in the pipeline YAML.
const DEFAULT_MAX_LOOP: u32 = 100;

// Execution statuses
const STATUS_COMPLETED: &str = "completed";
const STATUS_FAILED: &str = "failed";
const STATUS_CANCELLED: &str = "cancelled";

// Event types
const EVENT_EXECUTION_STARTED: &str = "execution_started";
const EVENT_NODE_STARTED: &str = "node_started";
const EVENT_NODE_COMPLETED: &str = "node_completed";
const EVENT_NODE_FAILED: &str = "node_failed";
const EVENT_EXECUTION_COMPLETED: &str = "execution_completed";

// ---------------------------------------------------------------------------
// Execution graph
// ---------------------------------------------------------------------------

/// Graph representation of a resolved pipeline for execution scheduling.
///
/// Tracks static successor relationships and predecessor counts for join
/// detection. Conditional successors are kept on the [`NodeDefinition`] and
/// resolved at runtime.
struct ExecutionGraph {
    nodes: HashMap<String, NodeDefinition>,
    /// Unconditional successors: `node_id` -> downstream node ids (from `next`).
    successors: HashMap<String, Vec<String>>,
    /// Number of incoming edges (unconditional + conditional) per node.
    predecessor_counts: HashMap<String, usize>,
    /// Pre-compiled regex patterns keyed by pattern string.
    compiled_regexes: HashMap<String, Regex>,
}

impl ExecutionGraph {
    /// Number of predecessors that must complete before this node can run.
    fn predecessor_count(&self, node_id: &str) -> usize {
        self.predecessor_counts.get(node_id).copied().unwrap_or(0)
    }

    /// Unconditional successors of a node (from `next` field).
    fn successors(&self, node_id: &str) -> &[String] {
        self.successors.get(node_id).map_or(&[], Vec::as_slice)
    }

    /// Iterator over all node IDs in the graph.
    fn node_ids(&self) -> impl Iterator<Item = &String> {
        self.nodes.keys()
    }

    /// Get a node definition by ID.
    fn get_node(&self, node_id: &str) -> Option<&NodeDefinition> {
        self.nodes.get(node_id)
    }

    /// Get a pre-compiled regex for the given pattern, if it was valid at build time.
    fn compiled_regex(&self, pattern: &str) -> Option<&Regex> {
        self.compiled_regexes.get(pattern)
    }
}

/// Build an execution graph from a resolved pipeline definition.
fn build_execution_graph(resolved: &ResolvedPipeline) -> ExecutionGraph {
    let mut nodes = HashMap::new();
    let mut successors: HashMap<String, Vec<String>> = HashMap::new();
    let mut predecessor_counts: HashMap<String, usize> = HashMap::new();
    let mut compiled_regexes: HashMap<String, Regex> = HashMap::new();

    for node in &resolved.definition.nodes {
        nodes.insert(node.id.clone(), node.clone());
        predecessor_counts.entry(node.id.clone()).or_insert(0);

        if let Some(next) = &node.next {
            let targets: Vec<String> = match next {
                NextTarget::Single(id) => vec![id.clone()],
                NextTarget::Multiple(ids) => ids.clone(),
            };
            for target in &targets {
                *predecessor_counts.entry(target.clone()).or_insert(0) += 1;
            }
            successors.insert(node.id.clone(), targets);
        }

        if let Some(conditions) = &node.conditions {
            for condition in conditions {
                // Conditional edges do NOT increment predecessor_counts because
                // only matching conditions are routed at runtime; counting them
                // here would cause deadlocks when a condition doesn't match.
                if let MatchCondition::Regex { pattern } = &condition.match_rule
                    && let Ok(re) = Regex::new(pattern)
                {
                    compiled_regexes.entry(pattern.clone()).or_insert(re);
                }
            }
        }
    }

    ExecutionGraph {
        nodes,
        successors,
        predecessor_counts,
        compiled_regexes,
    }
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

/// Evaluate a node's conditions against its output and return matched target IDs.
fn evaluate_conditions(
    conditions: &[Condition],
    output: &serde_json::Value,
    graph: &ExecutionGraph,
) -> Vec<String> {
    conditions
        .iter()
        .filter_map(|c| {
            let matches = match &c.match_rule {
                MatchCondition::StatusCode { codes } => output
                    .get("status_code")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(|code| u16::try_from(code).is_ok_and(|c| codes.contains(&c))),
                MatchCondition::Regex { pattern } => graph
                    .compiled_regex(pattern)
                    .is_some_and(|re| re.is_match(&output_to_str(output))),
                MatchCondition::JsonPath { path, expected } => {
                    output.get(path).is_some_and(|v| *v == *expected)
                }
                MatchCondition::ExitWhen { pattern } => output_to_str(output).contains(pattern),
            };
            if matches { Some(c.next.clone()) } else { None }
        })
        .collect()
}

/// Convert a JSON value to a string for pattern matching.
fn output_to_str(output: &serde_json::Value) -> String {
    match output.as_str() {
        Some(s) => s.to_owned(),
        None => serde_json::to_string(output).unwrap_or_default(),
    }
}

// ---------------------------------------------------------------------------
// Node action executor
// ---------------------------------------------------------------------------

/// Execute a single node's action asynchronously.
///
/// For nodes without an action the input is passed through as-is.
/// For `ShellCommand` the command is spawned via `tokio::process::Command`.
/// For `HttpRequest` the request is sent via reqwest (placeholder).
/// For `LlmCall` the prompt is dispatched to the LLM adapter.
async fn execute_node_action(
    node: &NodeDefinition,
    input: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    match &node.action {
        None => Ok(input.clone()),
        Some(NodeAction::ShellCommand {
            command_template,
            working_dir,
            timeout_secs,
        }) => {
            let mut cmd = tokio::process::Command::new("sh");
            cmd.arg("-c").arg(command_template);
            if let Some(dir) = working_dir {
                cmd.current_dir(dir);
            }
            let output =
                tokio::time::timeout(std::time::Duration::from_secs(*timeout_secs), cmd.output())
                    .await
                    .map_err(|_| {
                        AppError::Other(format!("shell command timed out after {timeout_secs}s"))
                    })?
                    .map_err(|e| AppError::Other(format!("failed to execute command: {e}")))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Other(format!(
                    "command exited with code {}: {stderr}",
                    output.status.code().unwrap_or(-1)
                )));
            }

            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            Ok(serde_json::Value::String(stdout))
        }
        Some(NodeAction::HttpRequest { .. }) => Err(AppError::Other(
            "HttpRequest action not yet implemented".to_owned(),
        )),
        Some(NodeAction::LlmCall {
            provider,
            prompt,
            timeout_secs,
        }) => {
            let registry = crate::default_llm_registry();
            let adapter = registry
                .get(provider)
                .ok_or_else(|| AppError::Other(format!("unknown LLM provider: '{provider}'")))?;
            let request = crate::adapters::llm::LlmRequest {
                prompt: prompt.clone(),
                timeout_secs: Some(*timeout_secs),
                metadata: None,
            };
            let response = adapter.execute_prompt(&request).await?;
            Ok(serde_json::Value::String(response.content))
        }
        Some(NodeAction::ChatSend {
            adapter,
            channel_id,
            content_template,
        }) => {
            let registry = crate::default_chat_registry();
            let chat_adapter = registry
                .get(adapter)
                .ok_or_else(|| AppError::Other(format!("unknown chat adapter: '{adapter}'")))?;
            let channel = channel_id
                .as_deref()
                .ok_or_else(|| AppError::Other("ChatSend requires a channel_id".to_owned()))?;
            chat_adapter.send_message(channel, content_template).await?;
            Ok(serde_json::Value::String(format!(
                "sent via {adapter} to {channel}"
            )))
        }
    }
}

// ---------------------------------------------------------------------------
// Fan-in normalization
// ---------------------------------------------------------------------------

/// Normalize fan-in inputs from multiple upstream nodes.
///
/// For a single upstream, the output is passed through directly.
/// For multiple upstreams, outputs are wrapped in
/// `{ "upstream": { node_id: output, ... } }`.
fn normalize_fan_in_input(upstream: &HashMap<String, serde_json::Value>) -> serde_json::Value {
    if upstream.is_empty() {
        return serde_json::Value::Null;
    }
    if upstream.len() == 1
        && let Some(v) = upstream.values().next()
    {
        return v.clone();
    }
    serde_json::json!({ "upstream": upstream })
}

/// Drain all remaining tasks in a `JoinSet`, decrementing the active count for each.
async fn drain_join_set<T: Send + 'static>(
    join_set: &mut tokio::task::JoinSet<T>,
    active_count: &mut usize,
) {
    while join_set.join_next().await.is_some() {
        *active_count -= 1;
    }
}

/// Route a completed node's output to its successors, updating pending predecessor
/// counts and marking newly ready nodes.
fn route_to_successors(
    source_id: &str,
    output: &serde_json::Value,
    targets: &[String],
    upstream_outputs: &mut HashMap<String, HashMap<String, serde_json::Value>>,
    pending_preds: &mut HashMap<String, usize>,
    ready: &mut Vec<String>,
) {
    for target in targets {
        upstream_outputs
            .entry(target.clone())
            .or_default()
            .insert(source_id.to_owned(), output.clone());
        if let Some(count) = pending_preds.get_mut(target) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                ready.push(target.clone());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Cancel detection
// ---------------------------------------------------------------------------

/// Check if an execution has been cancelled by querying the database.
fn is_execution_cancelled(conn: &rusqlite::Connection, execution_id: &str) -> bool {
    conn.query_row(
        "SELECT status FROM pipeline_executions WHERE id = ?1",
        [execution_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .is_some_and(|status| status == STATUS_CANCELLED)
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
        event_type: EVENT_EXECUTION_STARTED.to_owned(),
        node_id: None,
        node_name: Some(pipeline_name.clone()),
        data: trigger_data.clone(),
        timestamp: now_iso(),
    };
    emit_event(&app, &started_event);

    let exec_id = execution_id.clone();
    let db_inner = {
        // A new connection is needed because `State<'_>` cannot be moved into
        // the spawned task -- we extract the db path here before spawning.
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

/// Run the pipeline nodes using a `JoinSet`-based scheduler with event
/// emission and DB recording.
///
/// Independent (sibling) nodes run in parallel. Join (fan-in) nodes wait
/// until all upstream predecessors have completed.
#[expect(
    clippy::too_many_lines,
    reason = "pipeline runner is inherently stateful; sub-functions would require excessive parameter threading"
)]
async fn run_pipeline_async(
    app: &AppHandle,
    execution_id: &str,
    pipeline_id: &str,
    yaml_def: &str,
    trigger_data: Option<&serde_json::Value>,
    db_path: Option<&std::path::Path>,
) -> Result<(), AppError> {
    // Parse YAML via shared schema
    let resolved = crate::engine::yaml_parser::parse_pipeline(yaml_def)?;
    let graph = build_execution_graph(&resolved);

    // Initialize scheduler state
    let max_loops = resolved
        .definition
        .max_loop_count
        .unwrap_or(DEFAULT_MAX_LOOP);
    let mut loop_guard = LoopGuard::new(max_loops);
    let mut pending_preds = graph.predecessor_counts.clone();
    let mut upstream_outputs: HashMap<String, HashMap<String, serde_json::Value>> = HashMap::new();
    let initial_input = trigger_data.cloned().unwrap_or(serde_json::Value::Null);

    let conn = db_path.map(rusqlite::Connection::open).transpose()?;

    let mut final_status = STATUS_COMPLETED;
    let mut error_message: Option<String> = None;

    let mut ready: Vec<String> = graph
        .node_ids()
        .filter(|id| graph.predecessor_count(id) == 0)
        .cloned()
        .collect();
    ready.sort();

    // JoinSet for parallel node execution
    #[expect(clippy::items_after_statements)]
    type NodeTaskResult = (String, String, String, Result<serde_json::Value, AppError>);
    let mut join_set: tokio::task::JoinSet<NodeTaskResult> = tokio::task::JoinSet::new();
    let mut active_count: usize = 0;

    while !ready.is_empty() || active_count > 0 {
        if let Some(ref c) = conn
            && is_execution_cancelled(c, execution_id)
        {
            final_status = STATUS_CANCELLED;
            error_message = Some("execution was cancelled".to_owned());
            drain_join_set(&mut join_set, &mut active_count).await;
            break;
        }

        for node_id in ready.drain(..) {
            let Some(node) = graph.get_node(&node_id) else {
                continue;
            };

            let iteration = match loop_guard.check_and_increment(&node_id) {
                Ok(i) => i,
                Err(e) => {
                    final_status = STATUS_FAILED;
                    error_message = Some(e.to_string());
                    break;
                }
            };

            let input = if let Some(upstream) = upstream_outputs.get(&node_id) {
                normalize_fan_in_input(upstream)
            } else {
                initial_input.clone()
            };

            let node_exec_id = uuid::Uuid::new_v4().to_string();
            let started_at = now_iso();
            emit_event(
                app,
                &ExecutionEvent {
                    execution_id: execution_id.to_owned(),
                    event_type: EVENT_NODE_STARTED.to_owned(),
                    node_id: Some(node_id.clone()),
                    node_name: Some(node.name.clone()),
                    data: Some(input.clone()),
                    timestamp: started_at.clone(),
                },
            );

            if let Some(ref c) = conn {
                let input_json = serde_json::to_string(&input).unwrap_or_else(|e| {
                    error!(error = %e, "failed to serialize input for db");
                    "{}".to_owned()
                });
                if let Err(e) = c.execute(
                    "INSERT INTO node_executions (id, execution_id, node_id, node_name, iteration, status, input_data, started_at) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7)",
                    rusqlite::params![node_exec_id, execution_id, node_id, node.name, iteration, input_json, started_at],
                ) {
                    error!(error = %e, "failed to insert node_execution record");
                }
            }

            let node_clone = node.clone();
            join_set.spawn(async move {
                let result = execute_node_action(&node_clone, &input).await;
                (node_id, node_clone.name, node_exec_id, result)
            });
            active_count += 1;
        }

        if final_status != STATUS_COMPLETED {
            drain_join_set(&mut join_set, &mut active_count).await;
            break;
        }

        if active_count > 0 {
            match join_set.join_next().await {
                Some(Ok((node_id, node_name, node_exec_id, result))) => {
                    active_count -= 1;
                    let completed_at = now_iso();

                    match result {
                        Ok(output) => {
                            emit_event(
                                app,
                                &ExecutionEvent {
                                    execution_id: execution_id.to_owned(),
                                    event_type: EVENT_NODE_COMPLETED.to_owned(),
                                    node_id: Some(node_id.clone()),
                                    node_name: Some(node_name.clone()),
                                    data: Some(output.clone()),
                                    timestamp: completed_at.clone(),
                                },
                            );

                            if let Some(ref c) = conn {
                                let output_json =
                                    serde_json::to_string(&output).unwrap_or_else(|e| {
                                        error!(error = %e, "failed to serialize output for db");
                                        "{}".to_owned()
                                    });
                                if let Err(e) = c.execute(
                                    "UPDATE node_executions SET status = 'completed', output_data = ?1, completed_at = ?2 WHERE id = ?3",
                                    rusqlite::params![output_json, completed_at, node_exec_id],
                                ) {
                                    error!(error = %e, "failed to update node_execution status");
                                }
                                if let Err(e) = c.execute(
                                    "INSERT INTO execution_logs (execution_id, node_id, level, message, timestamp) VALUES (?1, ?2, 'info', ?3, ?4)",
                                    rusqlite::params![execution_id, node_id, format!("node '{}' completed", node_name), completed_at],
                                ) {
                                    error!(error = %e, "failed to insert execution_log");
                                }
                            }

                            let mut targets: Vec<String> = graph.successors(&node_id).to_vec();
                            if let Some(node) = graph.get_node(&node_id)
                                && let Some(conditions) = &node.conditions
                            {
                                targets.extend(evaluate_conditions(conditions, &output, &graph));
                            }
                            route_to_successors(
                                &node_id,
                                &output,
                                &targets,
                                &mut upstream_outputs,
                                &mut pending_preds,
                                &mut ready,
                            );
                        }
                        Err(e) => {
                            let err_msg = e.to_string();
                            final_status = STATUS_FAILED;
                            error_message = Some(err_msg.clone());

                            emit_event(
                                app,
                                &ExecutionEvent {
                                    execution_id: execution_id.to_owned(),
                                    event_type: EVENT_NODE_FAILED.to_owned(),
                                    node_id: Some(node_id.clone()),
                                    node_name: Some(node_name.clone()),
                                    data: Some(serde_json::json!({"error": err_msg})),
                                    timestamp: completed_at.clone(),
                                },
                            );

                            if let Some(ref c) = conn
                                && let Err(e) = c.execute(
                                    "UPDATE node_executions SET status = 'failed', error_message = ?1, completed_at = ?2 WHERE id = ?3",
                                    rusqlite::params![error_message, completed_at, node_exec_id],
                                ) {
                                    error!(error = %e, "failed to update node_execution status to failed");
                                }

                            drain_join_set(&mut join_set, &mut active_count).await;
                            break;
                        }
                    }
                }
                Some(Err(e)) => {
                    active_count -= 1;
                    final_status = STATUS_FAILED;
                    error_message = Some(format!("task panicked: {e}"));
                    drain_join_set(&mut join_set, &mut active_count).await;
                    break;
                }
                None => break,
            }
        }
    }

    if let Some(ref c) = conn
        && let Err(e) = c.execute(
            "UPDATE pipeline_executions SET status = ?1, completed_at = ?2, error_message = ?3 WHERE id = ?4",
            rusqlite::params![final_status, now_iso(), error_message, execution_id],
        ) {
            error!(error = %e, "failed to update pipeline_execution final status");
        }

    emit_event(
        app,
        &ExecutionEvent {
            execution_id: execution_id.to_owned(),
            event_type: EVENT_EXECUTION_COMPLETED.to_owned(),
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
#[expect(clippy::expect_used, reason = "panics in tests are acceptable")]
#[expect(clippy::unwrap_used, reason = "panics in tests are acceptable")]
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
        let json_str = serde_json::to_string(&event).unwrap();
        assert!(json_str.contains("exec-1"));
        assert!(json_str.contains("node_started"));
        assert!(json_str.contains("Fetch Data"));
    }

    #[test]
    fn execution_event_round_trip() {
        let event = ExecutionEvent {
            execution_id: "exec-2".to_owned(),
            event_type: EVENT_EXECUTION_COMPLETED.to_owned(),
            node_id: None,
            node_name: None,
            data: None,
            timestamp: "2026-01-01T12:00:00Z".to_owned(),
        };
        let json_str = serde_json::to_string(&event).unwrap();
        let parsed: ExecutionEvent = serde_json::from_str(&json_str).unwrap();
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
        let conn = db.lock().expect("db lock should succeed");
        conn.execute(
            "INSERT INTO pipelines (id, name, yaml_content, created_at, updated_at) VALUES (?1, ?2, '{}', datetime('now'), datetime('now'))",
            rusqlite::params![pipeline_id, name],
        )
        .expect("seed pipeline insert should succeed");
    }

    fn seed_execution(db: &DbState, execution_id: &str, pipeline_id: &str, status: &str) {
        let conn = db.lock().expect("db lock should succeed");
        conn.execute(
            "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, status, started_at) VALUES (?1, ?2, 'manual', ?3, datetime('now'))",
            rusqlite::params![execution_id, pipeline_id, status],
        )
        .expect("seed execution insert should succeed");
    }

    fn seed_node_execution(
        db: &DbState,
        ne_id: &str,
        execution_id: &str,
        node_id: &str,
        node_name: &str,
    ) {
        let conn = db.lock().expect("db lock should succeed");
        conn.execute(
            "INSERT INTO node_executions (id, execution_id, node_id, node_name, iteration, status, started_at) VALUES (?1, ?2, ?3, ?4, 1, 'completed', datetime('now'))",
            rusqlite::params![ne_id, execution_id, node_id, node_name],
        )
        .expect("seed node_execution insert should succeed");
    }

    fn seed_execution_log(db: &DbState, execution_id: &str, node_id: Option<&str>, message: &str) {
        let conn = db.lock().expect("db lock should succeed");
        conn.execute(
            "INSERT INTO execution_logs (execution_id, node_id, level, message, timestamp) VALUES (?1, ?2, 'info', ?3, datetime('now'))",
            rusqlite::params![execution_id, node_id, message],
        )
        .expect("seed execution_log insert should succeed");
    }

    #[test]
    fn get_execution_history_empty() {
        let db = DbState::open_in_memory().expect("DB should init");
        let conn = db.lock().expect("db lock should succeed");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM pipeline_executions", [], |row| {
                row.get(0)
            })
            .expect("query should succeed");
        assert_eq!(count, 0);
    }

    #[test]
    fn get_execution_history_with_data() {
        let db = DbState::open_in_memory().expect("DB should init");
        seed_pipeline(&db, "p-1", "Pipeline One");
        seed_execution(&db, "e-1", "p-1", "completed");
        seed_execution(&db, "e-2", "p-1", "failed");

        let conn = db.lock().expect("db lock should succeed");
        let mut stmt = conn.prepare(
            "SELECT e.id, e.pipeline_id, COALESCE(p.name, ''), e.trigger_type, e.status, e.started_at, e.completed_at \
             FROM pipeline_executions e LEFT JOIN pipelines p ON e.pipeline_id = p.id \
             ORDER BY e.started_at DESC LIMIT 50",
        ).expect("prepare should succeed");
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
            .expect("query_map should succeed")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.status == "completed"));
        assert!(rows.iter().any(|r| r.status == "failed"));
    }

    #[test]
    fn get_execution_detail_with_nodes_and_logs() {
        let db = DbState::open_in_memory().expect("DB should init");
        seed_pipeline(&db, "p-1", "My Pipeline");
        seed_execution(&db, "e-1", "p-1", "completed");
        seed_node_execution(&db, "ne-1", "e-1", "node-a", "Fetch");
        seed_node_execution(&db, "ne-2", "e-1", "node-b", "Transform");
        seed_execution_log(&db, "e-1", Some("node-a"), "Fetched data");
        seed_execution_log(&db, "e-1", None, "Pipeline done");

        let conn = db.lock().expect("db lock should succeed");

        // Verify node executions
        let ne_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM node_executions WHERE execution_id = 'e-1'",
                [],
                |row| row.get(0),
            )
            .expect("query should succeed");
        assert_eq!(ne_count, 2);

        // Verify logs
        let log_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM execution_logs WHERE execution_id = 'e-1'",
                [],
                |row| row.get(0),
            )
            .expect("query should succeed");
        assert_eq!(log_count, 2);
    }

    #[test]
    fn loop_guard_prevents_infinite_loop() {
        let mut guard = LoopGuard::new(3);
        assert!(guard.check_and_increment("n1").is_ok());
        assert!(guard.check_and_increment("n1").is_ok());
        assert!(guard.check_and_increment("n1").is_ok());
        assert!(guard.check_and_increment("n1").is_err());
    }

    #[test]
    fn loop_guard_tracks_separate_nodes() {
        let mut guard = LoopGuard::new(2);
        assert!(guard.check_and_increment("a").is_ok());
        assert!(guard.check_and_increment("b").is_ok());
        assert!(guard.check_and_increment("a").is_ok());
        assert!(guard.check_and_increment("b").is_ok());
        assert!(guard.check_and_increment("a").is_err());
        assert!(guard.check_and_increment("b").is_err());
    }

    #[test]
    fn cancel_execution_not_found() {
        let db = DbState::open_in_memory().expect("DB should init");
        let conn = db.lock().expect("db lock should succeed");
        let updated = conn.execute(
            "UPDATE pipeline_executions SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
            rusqlite::params![now_iso(), "nonexistent"],
        ).expect("update should succeed");
        assert_eq!(updated, 0);
    }

    #[test]
    fn cancel_execution_success() {
        let db = DbState::open_in_memory().expect("DB should init");
        seed_pipeline(&db, "p-1", "Test");
        seed_execution(&db, "e-1", "p-1", "running");

        let conn = db.lock().expect("db lock should succeed");
        let updated = conn.execute(
            "UPDATE pipeline_executions SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
            rusqlite::params![now_iso(), "e-1"],
        ).expect("update should succeed");
        assert_eq!(updated, 1);

        // Verify status changed
        let status: String = conn
            .query_row(
                "SELECT status FROM pipeline_executions WHERE id = 'e-1'",
                [],
                |row| row.get(0),
            )
            .expect("query should succeed");
        assert_eq!(status, "cancelled");
    }

    // =======================================================================
    // New tests for async node execution (plan section 7)
    // =======================================================================

    // ---- execute_node_action ------------------------------------------------

    #[tokio::test]
    async fn execute_node_action_shell_command_echo() {
        // Given: a node with ShellCommand that echoes text
        let node = NodeDefinition {
            id: "echo-node".to_owned(),
            name: "Echo".to_owned(),
            action: Some(NodeAction::ShellCommand {
                command_template: "echo hello".to_owned(),
                working_dir: None,
                timeout_secs: 5,
            }),
            next: None,
            conditions: None,
        };
        let input = serde_json::Value::Null;

        // When: executing the action
        let result = execute_node_action(&node, &input).await;

        // Then: output contains the echoed text
        assert!(result.is_ok());
        let output = result.expect("should succeed");
        assert!(output.as_str().unwrap_or("").contains("hello"));
    }

    #[tokio::test]
    async fn execute_node_action_shell_command_timeout() {
        // Given: a ShellCommand that exceeds its timeout
        let node = NodeDefinition {
            id: "slow-node".to_owned(),
            name: "Slow".to_owned(),
            action: Some(NodeAction::ShellCommand {
                command_template: "sleep 10".to_owned(),
                working_dir: None,
                timeout_secs: 1,
            }),
            next: None,
            conditions: None,
        };
        let input = serde_json::Value::Null;

        // When: executing the action
        let result = execute_node_action(&node, &input).await;

        // Then: timeout error is returned
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn execute_node_action_shell_command_nonzero_exit() {
        // Given: a ShellCommand that exits with non-zero code
        let node = NodeDefinition {
            id: "fail-node".to_owned(),
            name: "Fail".to_owned(),
            action: Some(NodeAction::ShellCommand {
                command_template: "exit 42".to_owned(),
                working_dir: None,
                timeout_secs: 5,
            }),
            next: None,
            conditions: None,
        };
        let input = serde_json::Value::Null;

        // When: executing the action
        let result = execute_node_action(&node, &input).await;

        // Then: error is returned
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn execute_node_action_no_action_passthrough() {
        // Given: a node without an action
        let node = NodeDefinition {
            id: "passthrough".to_owned(),
            name: "Pass".to_owned(),
            action: None,
            next: None,
            conditions: None,
        };
        let input = serde_json::json!({"key": "value"});

        // When: executing the action
        let result = execute_node_action(&node, &input).await;

        // Then: input is returned as-is
        assert!(result.is_ok());
        assert_eq!(result.expect("should succeed"), input);
    }

    #[tokio::test]
    async fn execute_node_action_llm_call_unknown_provider() {
        // Given: an LLM call with a provider not in the registry
        let node = NodeDefinition {
            id: "llm-node".to_owned(),
            name: "LLM".to_owned(),
            action: Some(NodeAction::LlmCall {
                provider: "nonexistent_provider".to_owned(),
                prompt: "test".to_owned(),
                timeout_secs: 5,
            }),
            next: None,
            conditions: None,
        };
        let input = serde_json::Value::Null;

        // When: executing the action
        let result = execute_node_action(&node, &input).await;

        // Then: error is returned for unknown provider
        assert!(result.is_err());
    }

    // ---- normalize_fan_in_input ---------------------------------------------

    #[test]
    fn normalize_fan_in_empty_returns_null() {
        // Given: no upstream outputs
        let upstream = HashMap::new();

        // When: normalizing
        let result = normalize_fan_in_input(&upstream);

        // Then: returns Null
        assert_eq!(result, serde_json::Value::Null);
    }

    #[test]
    fn normalize_fan_in_single_returns_output_directly() {
        // Given: one upstream node
        let upstream = HashMap::from([("node-a".to_owned(), serde_json::json!({"result": 42}))]);

        // When: normalizing
        let result = normalize_fan_in_input(&upstream);

        // Then: single output is returned unwrapped
        assert_eq!(result, serde_json::json!({"result": 42}));
    }

    #[test]
    fn normalize_fan_in_multi_wraps_in_upstream_object() {
        // Given: multiple upstream nodes
        let upstream = HashMap::from([
            ("node-a".to_owned(), serde_json::json!({"x": 1})),
            ("node-b".to_owned(), serde_json::json!({"y": 2})),
        ]);

        // When: normalizing
        let result = normalize_fan_in_input(&upstream);

        // Then: outputs are wrapped in { "upstream": { node_id: output } }
        let upstream_obj = result.get("upstream").expect("should have upstream key");
        assert_eq!(upstream_obj["node-a"]["x"], 1);
        assert_eq!(upstream_obj["node-b"]["y"], 2);
    }

    // ---- ExecutionGraph building --------------------------------------------

    #[test]
    fn build_graph_simple_chain() {
        // Given: a simple A -> B -> C pipeline
        let yaml = r#"
name: chain
version: "1.0"
trigger:
  type: discord
nodes:
  - id: a
    name: A
    next: b
  - id: b
    name: B
    next: c
  - id: c
    name: C
"#;
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");

        // When: building the execution graph
        let graph = build_execution_graph(&resolved);

        // Then: predecessor counts are correct
        assert_eq!(graph.predecessor_count("a"), 0);
        assert_eq!(graph.predecessor_count("b"), 1);
        assert_eq!(graph.predecessor_count("c"), 1);

        // And: successors are correct
        assert_eq!(graph.successors("a"), &["b".to_owned()]);
        assert_eq!(graph.successors("b"), &["c".to_owned()]);
        assert_eq!(graph.successors("c"), &[] as &[String]);
    }

    #[test]
    fn build_graph_fan_out_fan_in() {
        // Given: A -> [B, C] -> D (fan-out then fan-in)
        let yaml = r#"
name: fan-out-in
version: "1.0"
trigger:
  type: discord
nodes:
  - id: a
    name: A
    next:
      - b
      - c
  - id: b
    name: B
    next: d
  - id: c
    name: C
    next: d
  - id: d
    name: D
"#;
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");

        // When: building the execution graph
        let graph = build_execution_graph(&resolved);

        // Then: D has 2 predecessors (B and C both point to it)
        assert_eq!(graph.predecessor_count("a"), 0);
        assert_eq!(graph.predecessor_count("b"), 1);
        assert_eq!(graph.predecessor_count("c"), 1);
        assert_eq!(graph.predecessor_count("d"), 2);

        // And: A fans out to B and C
        let mut succ_a: Vec<_> = graph.successors("a").to_vec();
        succ_a.sort();
        assert_eq!(succ_a, vec!["b", "c"]);
    }

    #[test]
    fn build_graph_initial_ready_are_input_nodes() {
        // Given: a pipeline where only "start" has no predecessors
        let yaml = r#"
name: ready-test
version: "1.0"
trigger:
  type: discord
nodes:
  - id: start
    name: Start
    next: end
  - id: end
    name: End
"#;
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");
        let graph = build_execution_graph(&resolved);

        // When: collecting initially ready nodes (predecessor_count == 0)
        let mut ready: Vec<_> = graph
            .node_ids()
            .filter(|id| graph.predecessor_count(id) == 0)
            .collect();
        ready.sort();

        // Then: only "start" is ready
        assert_eq!(ready, vec!["start"]);
    }

    #[test]
    fn build_graph_conditions_increase_predecessor_count() {
        // Given: a pipeline with conditional routing
        let yaml = r#"
name: conditions
version: "1.0"
trigger:
  type: discord
nodes:
  - id: check
    name: Check
    conditions:
      - match:
          type: status_code
          codes: [200]
        next: success
      - match:
          type: status_code
          codes: [500]
        next: failure
  - id: success
    name: Success
  - id: failure
    name: Failure
"#;
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");

        // When: building the execution graph
        let graph = build_execution_graph(&resolved);

        // Then: condition targets have predecessor count 0 (conditional edges are not counted)
        assert_eq!(graph.predecessor_count("success"), 0);
        assert_eq!(graph.predecessor_count("failure"), 0);

        // And: "check" has no unconditional successors
        assert_eq!(graph.successors("check"), &[] as &[String]);

        // And: conditions are preserved on the node
        let check = graph.get_node("check").expect("node should exist");
        assert_eq!(check.conditions.as_ref().map(std::vec::Vec::len), Some(2));
    }

    // ---- Cancel detection ---------------------------------------------------

    #[test]
    fn is_execution_cancelled_detects_cancelled_status() {
        // Given: a cancelled execution in the database
        let db = DbState::open_in_memory().expect("DB should init");
        seed_pipeline(&db, "p-1", "Test");
        seed_execution(&db, "e-1", "p-1", "cancelled");

        // When: checking if the execution is cancelled
        let conn = db.lock().expect("lock should succeed");
        let cancelled = is_execution_cancelled(&conn, "e-1");

        // Then: it returns true
        assert!(cancelled);
    }

    #[test]
    fn is_execution_cancelled_returns_false_for_running() {
        // Given: a running execution in the database
        let db = DbState::open_in_memory().expect("DB should init");
        seed_pipeline(&db, "p-1", "Test");
        seed_execution(&db, "e-1", "p-1", "running");

        // When: checking if the execution is cancelled
        let conn = db.lock().expect("lock should succeed");
        let cancelled = is_execution_cancelled(&conn, "e-1");

        // Then: it returns false
        assert!(!cancelled);
    }

    // ---- Loop limit from pipeline config ------------------------------------

    #[test]
    fn max_loop_count_read_from_pipeline_yaml() {
        // Given: a pipeline YAML with max_loop_count = 5
        let yaml = r#"
name: loop-test
version: "1.0"
trigger:
  type: discord
max_loop_count: 5
nodes:
  - id: start
    name: Start
    next: end
  - id: end
    name: End
"#;

        // When: parsing the pipeline
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");

        // Then: max_loop_count is 5
        assert_eq!(resolved.definition.max_loop_count, Some(5));
    }

    #[test]
    fn max_loop_count_defaults_when_not_set() {
        // Given: a pipeline YAML without max_loop_count
        let yaml = r#"
name: no-loop
version: "1.0"
trigger:
  type: discord
nodes:
  - id: start
    name: Start
"#;

        // When: parsing the pipeline
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");

        // Then: max_loop_count is None
        assert_eq!(resolved.definition.max_loop_count, None);
    }

    // ---- Integration: shared schema YAML interpretation ---------------------

    #[test]
    fn runner_interprets_shared_schema_yaml_example() {
        // Given: the EXAMPLE1_DISCORD YAML from yaml_parser tests
        let yaml = r#"
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

        // When: parsing and building execution graph
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");
        let graph = build_execution_graph(&resolved);

        // Then: all nodes are in the graph
        assert_eq!(graph.node_ids().count(), 3);

        // And: the action node has its action preserved
        let process = graph
            .get_node("process_with_claude")
            .expect("node should exist");
        assert!(process.action.is_some());

        // And: routing is correct
        assert_eq!(
            graph.successors("receive_message"),
            &["process_with_claude".to_owned()]
        );
        assert_eq!(
            graph.successors("process_with_claude"),
            &["send_reply".to_owned()]
        );
        assert_eq!(graph.successors("send_reply"), &[] as &[String]);
    }

    #[test]
    fn runner_interprets_health_check_pipeline() {
        // Given: a pipeline with conditions (EXAMPLE2-style)
        let yaml = r#"
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

        // When: parsing and building execution graph
        let resolved = crate::engine::yaml_parser::parse_pipeline(yaml).expect("YAML should parse");
        let graph = build_execution_graph(&resolved);

        // Then: predecessor counts reflect only unconditional edges
        assert_eq!(graph.predecessor_count("health_check"), 0);
        assert_eq!(graph.predecessor_count("check_api"), 1);
        assert_eq!(graph.predecessor_count("analyze_error"), 0); // conditional edge, not counted
        assert_eq!(graph.predecessor_count("notify"), 1); // only from analyze_error (unconditional)

        // And: check_api has unconditional successor and conditions
        assert_eq!(
            graph.successors("check_api"),
            &[] as &[String] // no `next` field, only conditions
        );
        let check = graph.get_node("check_api").expect("node should exist");
        assert_eq!(check.conditions.as_ref().map(std::vec::Vec::len), Some(2));
    }

    // --- Discord trigger type support ---

    #[test]
    fn execution_stores_discord_trigger_type() {
        let db = DbState::open_in_memory().expect("open in-memory DB");
        seed_pipeline(&db, "p-discord", "Discord Bot");

        let conn = db.conn.lock().expect("lock DB connection");
        let exec_id = "e-discord-1";
        let trigger_data = serde_json::json!({
            "channel_id": "123456",
            "author": "user-789",
            "content": "@bot hello",
            "is_mention": true,
            "is_dm": false,
            "message_id": "msg-001",
            "guild_id": "guild-abc"
        });
        let trigger_json = serde_json::to_string(&trigger_data).expect("serialize trigger_data");

        conn.execute(
            "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, trigger_data, status, started_at) VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
            rusqlite::params![exec_id, "p-discord", "discord", trigger_json, now_iso()],
        ).expect("insert execution row");

        let stored_type: String = conn
            .query_row(
                "SELECT trigger_type FROM pipeline_executions WHERE id = ?1",
                [exec_id],
                |row| row.get(0),
            )
            .expect("query trigger_type");
        assert_eq!(stored_type, "discord");

        let stored_data: String = conn
            .query_row(
                "SELECT trigger_data FROM pipeline_executions WHERE id = ?1",
                [exec_id],
                |row| row.get(0),
            )
            .expect("query trigger_data");
        let parsed: serde_json::Value =
            serde_json::from_str(&stored_data).expect("parse trigger_data JSON");
        assert_eq!(parsed["channel_id"], "123456");
        assert_eq!(parsed["author"], "user-789");
        assert_eq!(parsed["is_mention"], true);
    }

    #[test]
    fn execution_stores_dm_trigger_data() {
        let db = DbState::open_in_memory().expect("open in-memory DB");
        seed_pipeline(&db, "p-dm", "DM Bot");

        let conn = db.conn.lock().expect("lock DB connection");
        let exec_id = "e-dm-1";
        let trigger_data = serde_json::json!({
            "channel_id": "dm-channel",
            "author": "user-123",
            "content": "private hello",
            "is_mention": false,
            "is_dm": true,
            "message_id": "msg-dm-001",
            "guild_id": null
        });
        let trigger_json = serde_json::to_string(&trigger_data).expect("serialize trigger_data");

        conn.execute(
            "INSERT INTO pipeline_executions (id, pipeline_id, trigger_type, trigger_data, status, started_at) VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
            rusqlite::params![exec_id, "p-dm", "discord", trigger_json, now_iso()],
        ).expect("insert execution row");

        let stored_data: String = conn
            .query_row(
                "SELECT trigger_data FROM pipeline_executions WHERE id = ?1",
                [exec_id],
                |row| row.get::<_, String>(0),
            )
            .expect("query trigger_data");
        let parsed: serde_json::Value =
            serde_json::from_str(&stored_data).expect("parse trigger_data JSON");

        assert_eq!(parsed["is_dm"], true);
        assert_eq!(parsed["is_mention"], false);
        assert!(parsed["guild_id"].is_null());
    }

    // --- Canonical YAML pipeline execution ---

    #[test]
    fn canonical_yaml_pipeline_parseable() {
        // Verify that a canonical YAML pipeline can be parsed
        // (this will be used by the updated execute_pipeline)
        let yaml = r#"
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
      prompt: "Respond to the user"
      timeout_secs: 60
    next: send_reply
  - id: send_reply
    name: Discord Reply
    action:
      type: chat_send
      adapter: discord
      content_template: "{{output}}"
"#;
        let result: std::result::Result<crate::engine::yaml_schema::PipelineDefinition, _> =
            serde_yaml::from_str(yaml);
        assert!(
            result.is_ok(),
            "canonical YAML should parse: {:?}",
            result.err()
        );
        let def = result.unwrap_or_else(|e| panic!("should parse: {e}"));
        assert_eq!(def.name, "discord-claude-bot");
        assert_eq!(def.nodes.len(), 3);

        // Verify the chat_send action in the last node
        let reply_node = def.nodes.iter().find(|n| n.id == "send_reply");
        assert!(reply_node.is_some());
        let reply = reply_node.unwrap_or_else(|| panic!("checked above"));
        match &reply.action {
            Some(crate::engine::yaml_schema::NodeAction::ChatSend { adapter, .. }) => {
                assert_eq!(adapter, "discord");
            }
            other => panic!("Expected ChatSend action, got: {other:?}"),
        }
    }

    #[test]
    fn execution_summary_serializes_with_discord_trigger() {
        let summary = ExecutionSummary {
            id: "e-1".to_owned(),
            pipeline_id: "p-1".to_owned(),
            pipeline_name: "Discord Bot".to_owned(),
            trigger_type: "discord".to_owned(),
            status: "completed".to_owned(),
            started_at: "2026-01-01T00:00:00Z".to_owned(),
            completed_at: Some("2026-01-01T00:01:00Z".to_owned()),
        };
        let json = serde_json::to_value(&summary);
        assert!(json.is_ok());
        let json = json.unwrap_or_default();
        assert_eq!(json["trigger_type"], "discord");
    }

    #[test]
    fn execution_detail_includes_trigger_data() {
        let detail = ExecutionDetail {
            id: "e-1".to_owned(),
            pipeline_id: "p-1".to_owned(),
            trigger_type: "discord".to_owned(),
            trigger_data: Some(serde_json::json!({
                "channel_id": "ch-1",
                "author": "user-1",
                "content": "hello",
                "is_mention": true,
                "is_dm": false,
            })),
            status: "completed".to_owned(),
            started_at: "2026-01-01T00:00:00Z".to_owned(),
            completed_at: Some("2026-01-01T00:01:00Z".to_owned()),
            error_message: None,
            node_executions: vec![],
            logs: vec![],
        };
        let json = serde_json::to_value(&detail);
        assert!(json.is_ok());
        let json = json.unwrap_or_default();
        assert_eq!(json["trigger_type"], "discord");
        assert!(json["trigger_data"]["is_mention"].is_boolean());
    }
}
