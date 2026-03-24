pub const CREATE_PIPELINES: &str = "
CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    yaml_content TEXT NOT NULL,
    max_loop_count INTEGER DEFAULT 10,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
)";

pub const CREATE_PIPELINE_EXECUTIONS: &str = "
CREATE TABLE IF NOT EXISTS pipeline_executions (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    trigger_type TEXT NOT NULL,
    trigger_data TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT
)";

pub const CREATE_NODE_EXECUTIONS: &str = "
CREATE TABLE IF NOT EXISTS node_executions (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    iteration INTEGER DEFAULT 1,
    status TEXT NOT NULL,
    input_data TEXT,
    output_data TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT
)";

pub const CREATE_EXECUTION_LOGS: &str = "
CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL,
    node_id TEXT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL
)";

pub const CREATE_SKILLS: &str = "
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    file_path TEXT NOT NULL,
    skill_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)";

/// Generic adapter config — not tied to any specific chat platform.
pub const CREATE_CHAT_ADAPTER_CONFIG: &str = "
CREATE TABLE IF NOT EXISTS chat_adapter_config (
    id TEXT PRIMARY KEY,
    adapter_type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)";

pub const CREATE_LLM_ADAPTER_CONFIG: &str = "
CREATE TABLE IF NOT EXISTS llm_adapter_config (
    id TEXT PRIMARY KEY,
    adapter_type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)";

pub const CREATE_CRON_JOBS: &str = "
CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL,
    schedule TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT
)";

/// All table creation statements in dependency order.
pub const ALL_TABLES: &[&str] = &[
    CREATE_PIPELINES,
    CREATE_PIPELINE_EXECUTIONS,
    CREATE_NODE_EXECUTIONS,
    CREATE_EXECUTION_LOGS,
    CREATE_SKILLS,
    CREATE_CHAT_ADAPTER_CONFIG,
    CREATE_LLM_ADAPTER_CONFIG,
    CREATE_CRON_JOBS,
];
