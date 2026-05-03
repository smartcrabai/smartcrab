-- Initial schema. Ported from crates/smartcrab-app/src-tauri/src/db/schema.rs.
-- Timestamps are stored as INTEGER (unix epoch milliseconds) instead of TEXT.

CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    yaml_content TEXT NOT NULL,
    max_loop_count INTEGER DEFAULT 10,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_executions (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    trigger_type TEXT NOT NULL,
    trigger_data TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    error TEXT
);

CREATE TABLE IF NOT EXISTS node_executions (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES pipeline_executions(id),
    node_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    iteration INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    input_data TEXT,
    output TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    error TEXT
);

CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL REFERENCES pipeline_executions(id),
    node_id TEXT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    body TEXT,
    file_path TEXT,
    skill_type TEXT,
    pipeline_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS chat_adapter_config (
    adapter_id TEXT PRIMARY KEY,
    adapter_type TEXT,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_adapter_config (
    adapter_id TEXT PRIMARY KEY,
    adapter_type TEXT,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    expression TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pipeline_executions_pipeline_id ON pipeline_executions(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_started_at ON pipeline_executions(started_at);
CREATE INDEX IF NOT EXISTS idx_node_executions_execution_id ON node_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id ON execution_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_timestamp ON execution_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_pipeline_id ON cron_jobs(pipeline_id);
