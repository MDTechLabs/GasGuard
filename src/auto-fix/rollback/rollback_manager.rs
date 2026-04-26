/// Auto-Fix Rollback System (#238)
/// Tracks applied fixes and provides a revert mechanism.

use std::collections::HashMap;

/// A single applied fix that can be rolled back.
#[derive(Debug, Clone)]
pub struct AppliedFix {
    pub id: String,
    pub file_path: String,
    pub original_content: String,
    pub patched_content: String,
    pub rule_id: String,
}

/// Manages a stack of applied fixes and supports rollback.
#[derive(Debug, Default)]
pub struct RollbackManager {
    history: Vec<AppliedFix>,
    /// Map from fix id → index in history for O(1) lookup.
    index: HashMap<String, usize>,
}

impl RollbackManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a fix that has been applied.
    pub fn record(&mut self, fix: AppliedFix) {
        let idx = self.history.len();
        self.index.insert(fix.id.clone(), idx);
        self.history.push(fix);
    }

    /// Revert the most recently applied fix.
    /// Returns the original content that should be written back to disk.
    pub fn rollback_last(&mut self) -> Option<AppliedFix> {
        let fix = self.history.pop()?;
        self.index.remove(&fix.id);
        Some(fix)
    }

    /// Revert a specific fix by id.
    /// Returns the fix if found, None otherwise.
    pub fn rollback_by_id(&mut self, id: &str) -> Option<AppliedFix> {
        let idx = *self.index.get(id)?;
        self.index.remove(id);
        Some(self.history.remove(idx))
    }

    /// Number of fixes currently tracked.
    pub fn len(&self) -> usize {
        self.history.len()
    }

    pub fn is_empty(&self) -> bool {
        self.history.is_empty()
    }

    /// List all tracked fix ids in application order.
    pub fn fix_ids(&self) -> Vec<&str> {
        self.history.iter().map(|f| f.id.as_str()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_fix(id: &str) -> AppliedFix {
        AppliedFix {
            id: id.to_string(),
            file_path: "contract.rs".to_string(),
            original_content: "original".to_string(),
            patched_content: "patched".to_string(),
            rule_id: "RULE-001".to_string(),
        }
    }

    #[test]
    fn test_record_and_rollback_last() {
        let mut mgr = RollbackManager::new();
        mgr.record(make_fix("fix-1"));
        mgr.record(make_fix("fix-2"));
        assert_eq!(mgr.len(), 2);

        let reverted = mgr.rollback_last().unwrap();
        assert_eq!(reverted.id, "fix-2");
        assert_eq!(mgr.len(), 1);
    }

    #[test]
    fn test_rollback_by_id() {
        let mut mgr = RollbackManager::new();
        mgr.record(make_fix("fix-1"));
        mgr.record(make_fix("fix-2"));

        let reverted = mgr.rollback_by_id("fix-1").unwrap();
        assert_eq!(reverted.id, "fix-1");
        assert_eq!(reverted.original_content, "original");
        assert_eq!(mgr.len(), 1);
    }

    #[test]
    fn test_rollback_unknown_id_returns_none() {
        let mut mgr = RollbackManager::new();
        assert!(mgr.rollback_by_id("nonexistent").is_none());
    }
}
