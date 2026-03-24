pub mod chat_adapter;
pub mod chat_ai;
pub mod cron;
pub mod execution;
pub mod pipeline;
pub mod skills;

#[cfg(test)]
pub(crate) fn test_db() -> rusqlite::Connection {
    crate::db::init(":memory:").unwrap_or_else(|e| panic!("in-memory db for tests: {e}"))
}
