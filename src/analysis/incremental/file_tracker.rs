use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;

/// Stored snapshot of a single file.
#[derive(Debug, Clone)]
pub struct FileSnapshot {
    /// Blake3/SHA-256 hex digest of the file contents.
    pub content_hash: String,
    /// Last modified timestamp from the filesystem.
    pub modified_at: SystemTime,
}

/// Tracks file states across successive analysis runs to detect changes.
#[derive(Debug, Default)]
pub struct FileTracker {
    /// Map from absolute file path → last known snapshot.
    snapshots: HashMap<String, FileSnapshot>,
}

impl FileTracker {
    pub fn new() -> Self { Self::default() }

    /// Compute a lightweight hash of `contents` (FNV-1a — no external deps).
    fn hash(contents: &[u8]) -> String {
        let mut h: u64 = 0xcbf29ce484222325;
        for &b in contents {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{:016x}", h)
    }

    /// Returns `true` when the file at `path` has changed since it was last
    /// recorded, or if it has never been seen before.
    pub fn has_changed(&self, path: &str, contents: &[u8]) -> bool {
        match self.snapshots.get(path) {
            None => true,
            Some(snap) => snap.content_hash != Self::hash(contents),
        }
    }

    /// Record the current state of a file.  Call this after a successful scan.
    pub fn record(&mut self, path: impl Into<String>, contents: &[u8]) {
        let path = path.into();
        let modified_at = Path::new(&path)
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        self.snapshots.insert(path, FileSnapshot {
            content_hash: Self::hash(contents),
            modified_at,
        });
    }

    /// Remove a file from the tracker (e.g. it was deleted).
    pub fn remove(&mut self, path: &str) {
        self.snapshots.remove(path);
    }

    /// Number of tracked files.
    pub fn len(&self) -> usize { self.snapshots.len() }

    /// Paths of all tracked files.
    pub fn tracked_paths(&self) -> Vec<&str> {
        self.snapshots.keys().map(String::as_str).collect()
    }
}