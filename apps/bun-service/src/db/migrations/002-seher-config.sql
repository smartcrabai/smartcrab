-- Singleton config row for seher-ts router settings (id is fixed to 1).

CREATE TABLE IF NOT EXISTS seher_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
