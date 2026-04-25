use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub fn collect_scannable_files(dir_path: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = walkdir::WalkDir::new(dir_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map_or(false, |ext| {
                matches!(ext.to_str().unwrap_or(""), "rs" | "vy" | "sol")
            })
        })
        .map(|e| e.path().to_path_buf())
        .collect();

    files.sort();
    files
}

pub struct ProgressReporter {
    total: usize,
    current: usize,
    width: usize,
    start: Instant,
    last_file: String,
}

impl ProgressReporter {
    pub fn new(total: usize) -> Self {
        Self {
            total,
            current: 0,
            width: 32,
            start: Instant::now(),
            last_file: String::new(),
        }
    }

    pub fn start(&self, message: &str) {
        println!("{}", message);
        if self.total > 0 {
            self.render();
        }
    }

    pub fn update_file(&mut self, file_path: &Path) {
        self.current = (self.current + 1).min(self.total);
        self.last_file = file_path.display().to_string();
        self.render();
    }

    pub fn finish(&self, message: &str) {
        if self.total > 0 {
            let elapsed = self.start.elapsed().as_secs_f32();
            println!("\n{} ({:.2}s)", message, elapsed);
        } else {
            println!("{}", message);
        }
    }

    fn render(&self) {
        let percent = if self.total == 0 {
            100.0
        } else {
            (self.current as f64 / self.total as f64) * 100.0
        };

        let filled = ((percent / 100.0) * self.width as f64).round() as usize;
        let filled = filled.min(self.width);
        let bar = format!(
            "{}{}",
            "#".repeat(filled),
            "-".repeat(self.width.saturating_sub(filled))
        );

        let file_name = if self.last_file.is_empty() {
            "starting...".to_string()
        } else {
            truncate_path(&self.last_file, 64)
        };

        print!(
            "\r[{}] {:>6.2}% ({}/{}) {}",
            bar, percent, self.current, self.total, file_name
        );
        let _ = io::stdout().flush();
    }
}

fn truncate_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        return path.to_string();
    }

    let suffix_len = max_len.saturating_sub(3);
    format!("...{}", &path[path.len().saturating_sub(suffix_len)..])
}
