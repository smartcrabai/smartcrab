use crate::error::AppError;
use std::collections::HashMap;

pub struct LoopGuard {
    max_count: u32,
    execution_counts: HashMap<String, u32>,
}

impl LoopGuard {
    #[must_use]
    pub fn new(max_count: u32) -> Self {
        Self {
            max_count,
            execution_counts: HashMap::new(),
        }
    }

    /// Check the iteration count for `node_id` and increment it.
    ///
    /// # Errors
    ///
    /// Returns [`AppError::Engine`] if the loop limit is exceeded.
    pub fn check_and_increment(&mut self, node_id: &str) -> Result<u32, AppError> {
        let count = self
            .execution_counts
            .entry(node_id.to_owned())
            .and_modify(|c| *c += 1)
            .or_insert(1);
        if *count > self.max_count {
            return Err(AppError::Engine(format!(
                "Loop limit {} exceeded for node '{}'",
                self.max_count, node_id
            )));
        }
        Ok(*count)
    }

    pub fn reset(&mut self) {
        self.execution_counts.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loop_guard_limit_enforcement() {
        let mut guard = LoopGuard::new(3);

        assert!(guard.check_and_increment("node_a").is_ok());
        assert!(guard.check_and_increment("node_a").is_ok());
        assert!(guard.check_and_increment("node_a").is_ok());

        let result = guard.check_and_increment("node_a");
        assert!(result.is_err());
        match result {
            Err(AppError::Engine(msg)) => {
                assert!(msg.contains("Loop limit 3 exceeded"));
                assert!(msg.contains("node_a"));
            }
            other => panic!("Expected Engine error, got: {other:?}"),
        }
    }

    #[test]
    fn test_loop_guard_reset() {
        let mut guard = LoopGuard::new(2);

        assert!(
            guard.check_and_increment("node_b").is_ok(),
            "first call should succeed"
        );
        assert!(
            guard.check_and_increment("node_b").is_ok(),
            "second call should succeed"
        );
        assert!(guard.check_and_increment("node_b").is_err());

        guard.reset();
        assert!(guard.check_and_increment("node_b").is_ok());
    }

    #[test]
    fn test_loop_guard_independent_nodes() {
        let mut guard = LoopGuard::new(1);

        assert!(guard.check_and_increment("node_x").is_ok());
        assert!(guard.check_and_increment("node_y").is_ok());
        assert!(guard.check_and_increment("node_x").is_err());
    }
}
