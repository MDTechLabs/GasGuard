pub mod file_tracker;

use file_tracker::FileTracker;
use analysis_core::plugin::{AnalysisInput, PluginRegistry, SessionOutput};

/// Result of an incremental scan.
#[derive(Debug)]
pub struct IncrementalResult {
    pub session: SessionOutput,
    /// Paths that were scanned (changed or new).
    pub scanned: Vec<String>,
    /// Paths that were skipped because they were unchanged.
    pub skipped: Vec<String>,
}

/// Wraps a [`PluginRegistry`] and a [`FileTracker`] to perform incremental
/// analysis — only changed files are re-analysed.
pub struct IncrementalScanner {
    tracker: FileTracker,
}

impl IncrementalScanner {
    pub fn new() -> Self {
        Self { tracker: FileTracker::new() }
    }

    /// Run an incremental scan over `inputs`.
    ///
    /// Files whose content has not changed since the last call are skipped.
    /// After a successful scan the tracker snapshot is updated for every file
    /// that was analysed.
    pub fn scan(
        &mut self,
        registry: &mut PluginRegistry,
        inputs: Vec<AnalysisInput>,
    ) -> IncrementalResult {
        let mut to_scan: Vec<AnalysisInput> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();

        for input in inputs {
            let bytes = input.source.as_bytes();
            if self.tracker.has_changed(&input.file_path, bytes) {
                to_scan.push(input);
            } else {
                skipped.push(input.file_path);
            }
        }

        let scanned: Vec<String> = to_scan.iter().map(|i| i.file_path.clone()).collect();
        let session = registry.run_session(&to_scan);

        // Update snapshots only for files that were successfully processed.
        for input in &to_scan {
            self.tracker.record(&input.file_path, input.source.as_bytes());
        }

        IncrementalResult { session, scanned, skipped }
    }

    /// Force-invalidate a file so it will be rescanned next time.
    pub fn invalidate(&mut self, path: &str) {
        self.tracker.remove(path);
    }

    /// How many files the tracker currently remembers.
    pub fn tracked_count(&self) -> usize {
        self.tracker.len()
    }
}

impl Default for IncrementalScanner {
    fn default() -> Self { Self::new() }
}