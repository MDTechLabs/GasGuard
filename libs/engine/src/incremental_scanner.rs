use anyhow::{Context, Result};
use gasguard_ast::{UnifiedAST, Language as AstLanguage};
use gasguard_rule_engine::{RuleEngine, RuleViolation};
use gasguard_parser_rust::RustParser;
use gasguard_parser_solidity::SolidityParser;
use gasguard_parser_vyper::VyperParser;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::{ScanResult, ContractScanner, Language};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHashInfo {
    pub file_path: PathBuf,
    pub content_hash: String,
    pub last_modified: u64,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashComparisonResult {
    pub unchanged: Vec<FileHashInfo>,
    pub modified: Vec<FileHashInfo>,
    pub added: Vec<FileHashInfo>,
    pub deleted: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisCacheEntry {
    pub file_path: PathBuf,
    pub content_hash: String,
    pub analysis_result: ScanResult,
    pub timestamp: u64,
    pub dependencies: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub nodes: HashMap<PathBuf, HashSet<PathBuf>>,
    pub reverse_nodes: HashMap<PathBuf, HashSet<PathBuf>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncrementalAnalysisResult {
    pub cached_results: Vec<AnalysisCacheEntry>,
    pub new_results: Vec<ScanResult>,
    pub modified_files: Vec<PathBuf>,
    pub analysis_time: u64,
    pub total_files: usize,
    pub cache_hit_rate: f64,
}

pub struct IncrementalScanner {
    rule_engine: RuleEngine,
    cache_dir: PathBuf,
}

impl IncrementalScanner {
    pub fn new<P: AsRef<Path>>(cache_dir: P) -> Self {
        let rule_engine = RuleEngine::new();
        Self {
            rule_engine,
            cache_dir: cache_dir.as_ref().to_path_buf(),
        }
    }

    /// Generate content-based hash for a file
    pub async fn generate_file_hash(&self, file_path: &Path) -> Result<FileHashInfo> {
        use std::fs;
        use std::time::SystemTime;
        
        let content = fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {:?}", file_path))?;
        
        let metadata = fs::metadata(file_path)
            .with_context(|| format!("Failed to get metadata for: {:?}", file_path))?;
        
        let content_hash = sha256::digest(&content);
        let last_modified = metadata.modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        Ok(FileHashInfo {
            file_path: file_path.to_path_buf(),
            content_hash,
            last_modified,
            file_size: metadata.len(),
        })
    }

    /// Generate hashes for multiple files
    pub async fn generate_multiple_file_hashes(&self, file_paths: &[PathBuf]) -> Result<Vec<FileHashInfo>> {
        let mut hashes = Vec::new();
        for file_path in file_paths {
            hashes.push(self.generate_file_hash(file_path).await?);
        }
        Ok(hashes)
    }

    /// Get cached hash information
    pub async fn get_cached_hashes(&self, repo_path: &Path) -> Result<HashMap<PathBuf, FileHashInfo>> {
        let cache_file = self.cache_dir.join(format!("{}.hashes", repo_path.display()));
        
        if !cache_file.exists() {
            return Ok(HashMap::new());
        }
        
        let content = std::fs::read_to_string(&cache_file)?;
        let hashes: HashMap<String, FileHashInfo> = serde_json::from_str(&content)
            .with_context(|| "Failed to parse cached hashes")?;
        
        Ok(hashes.into_iter()
            .map(|(k, v)| (PathBuf::from(k), v))
            .collect())
    }

    /// Cache hash information
    pub async fn cache_hashes(&self, repo_path: &Path, hashes: &HashMap<PathBuf, FileHashInfo>) -> Result<()> {
        use std::fs;
        
        fs::create_dir_all(&self.cache_dir)?;
        
        let cache_file = self.cache_dir.join(format!("{}.hashes", repo_path.display()));
        
        let serializable: HashMap<String, FileHashInfo> = hashes
            .iter()
            .map(|(k, v)| (k.to_string_lossy().to_string(), v.clone()))
            .collect();
        
        let content = serde_json::to_string_pretty(&serializable)?;
        fs::write(cache_file, content)?;
        
        Ok(())
    }

    /// Compare current file hashes with cached hashes
    pub async fn compare_with_cache(
        &self,
        repo_path: &Path,
        current_files: &[PathBuf],
    ) -> Result<HashComparisonResult> {
        let cached_hashes = self.get_cached_hashes(repo_path).await?;
        let current_hashes = self.generate_multiple_file_hashes(current_files).await?;
        
        let mut unchanged = Vec::new();
        let mut modified = Vec::new();
        let mut added = Vec::new();
        let mut deleted = Vec::new();

        let current_hash_map: HashMap<PathBuf, FileHashInfo> = current_hashes
            .into_iter()
            .map(|info| (info.file_path.clone(), info))
            .collect();

        // Check for modified and unchanged files
        for (file_path, current_info) in &current_hash_map {
            if let Some(cached_info) = cached_hashes.get(file_path) {
                if cached_info.content_hash == current_info.content_hash {
                    unchanged.push(current_info.clone());
                } else {
                    modified.push(current_info.clone());
                }
            } else {
                added.push(current_info.clone());
            }
        }

        // Check for deleted files
        for file_path in cached_hashes.keys() {
            if !current_hash_map.contains_key(file_path) {
                deleted.push(file_path.clone());
            }
        }

        Ok(HashComparisonResult {
            unchanged,
            modified,
            added,
            deleted,
        })
    }

    /// Find files that depend on modified files
    pub async fn find_dependent_files(
        &self,
        modified_files: &[PathBuf],
        all_files: &[PathBuf],
    ) -> Result<Vec<PathBuf>> {
        let mut dependent_files = HashSet::new();
        
        for modified_file in modified_files {
            let dependencies = self.detect_dependencies(modified_file, all_files).await?;
            for dep in dependencies {
                dependent_files.insert(dep);
            }
        }
        
        Ok(dependent_files.into_iter().collect())
    }

    /// Basic dependency detection between files
    async fn detect_dependencies(
        &self,
        source_file: &Path,
        all_files: &[PathBuf],
    ) -> Result<Vec<PathBuf>> {
        let mut dependencies = Vec::new();
        
        let content = std::fs::read_to_string(source_file)?;
        let source_dir = source_file.parent().unwrap_or_else(|| Path::new("."));
        let source_ext = source_file.extension().and_then(|s| s.to_str()).unwrap_or("");

        match source_ext {
            "rs" => {
                // Rust dependencies
                let import_regex = regex::Regex::new(r"use\s+([^;]+);")?;
                for captures in import_regex.captures_iter(&content) {
                    if let Some(module_path) = captures.get(1) {
                        let module_str = module_path.as_str().trim();
                        let possible_files = self.resolve_rust_import(module_str, source_dir, all_files);
                        dependencies.extend(possible_files);
                    }
                }
            }
            "sol" | "vy" => {
                // Solidity/Vyper dependencies
                let import_regex = regex::Regex::new(r#"import\s+["']([^"']+)["']"#)?;
                for captures in import_regex.captures_iter(&content) {
                    if let Some(import_path) = captures.get(1) {
                        let import_str = import_path.as_str();
                        let possible_files = self.resolve_solidity_import(import_str, source_dir, all_files);
                        dependencies.extend(possible_files);
                    }
                }
            }
            _ => {}
        }

        Ok(dependencies.into_iter().filter(|dep| all_files.contains(dep)).collect())
    }

    /// Resolve Rust import paths to actual files
    fn resolve_rust_import(
        &self,
        module_path: &str,
        source_dir: &Path,
        all_files: &[PathBuf],
    ) -> Vec<PathBuf> {
        let mut possible_files = Vec::new();
        
        if module_path.starts_with("crate::") {
            let relative_path = module_path.replace("crate::", "").replace("::", "/");
            
            let possible_file = source_dir.join("../src").join(&relative_path).with_extension("rs");
            let possible_mod_dir = source_dir.join("../src").join(&relative_path).join("mod.rs");
            
            if all_files.contains(&possible_file) {
                possible_files.push(possible_file);
            }
            if all_files.contains(&possible_mod_dir) {
                possible_files.push(possible_mod_dir);
            }
        }
        
        possible_files
    }

    /// Resolve Solidity import paths to actual files
    fn resolve_solidity_import(
        &self,
        import_path: &str,
        source_dir: &Path,
        all_files: &[PathBuf],
    ) -> Vec<PathBuf> {
        let mut possible_files = Vec::new();
        
        // Relative imports
        if import_path.starts_with("./") || import_path.starts_with("../") {
            let absolute_path = source_dir.join(import_path);
            
            // Try to find a file that matches this path
            for file in all_files {
                if file.starts_with(&absolute_path) {
                    possible_files.push(file.clone());
                    break;
                }
            }
        }
        
        // Try adding .sol extension if not present
        if !import_path.ends_with(".sol") {
            let with_sol_ext = source_dir.join(format!("{}.sol", import_path));
            if all_files.contains(&with_sol_ext) {
                possible_files.push(with_sol_ext);
            }
        }
        
        possible_files
    }

    /// Get cached analysis results
    pub async fn get_cached_analysis(&self, repo_path: &Path) -> Result<HashMap<PathBuf, AnalysisCacheEntry>> {
        let cache_file = self.cache_dir.join(format!("{}.analysis", repo_path.display()));
        
        if !cache_file.exists() {
            return Ok(HashMap::new());
        }
        
        let content = std::fs::read_to_string(&cache_file)?;
        let analysis: HashMap<String, AnalysisCacheEntry> = serde_json::from_str(&content)
            .with_context(|| "Failed to parse cached analysis")?;
        
        Ok(analysis.into_iter()
            .map(|(k, v)| (PathBuf::from(k), v))
            .collect())
    }

    /// Cache analysis results
    pub async fn cache_analysis_results(
        &self,
        repo_path: &Path,
        results: &HashMap<PathBuf, AnalysisCacheEntry>,
    ) -> Result<()> {
        use std::fs;
        
        fs::create_dir_all(&self.cache_dir)?;
        
        let cache_file = self.cache_dir.join(format!("{}.analysis", repo_path.display()));
        
        let serializable: HashMap<String, AnalysisCacheEntry> = results
            .iter()
            .map(|(k, v)| (k.to_string_lossy().to_string(), v.clone()))
            .collect();
        
        let content = serde_json::to_string_pretty(&serializable)?;
        fs::write(cache_file, content)?;
        
        Ok(())
    }

    /// Perform incremental analysis
    pub async fn perform_incremental_analysis<F, Fut>(
        &self,
        repo_path: &Path,
        analysis_function: F,
    ) -> Result<IncrementalAnalysisResult>
    where
        F: Fn(Vec<PathBuf>) -> Fut + Send + Sync,
        Fut: std::future::Future<Output = Result<Vec<ScanResult>>> + Send,
    {
        let start_time = SystemTime::now();
        
        // Find all supported files
        let all_files = self.find_supported_files(repo_path)?;
        
        // Get hash comparison
        let hash_comparison = self.compare_with_cache(repo_path, &all_files).await?;
        
        // Get cached analysis results
        let mut cached_analysis = self.get_cached_analysis(repo_path).await?;
        
        // Determine which files need re-analysis
        let mut files_to_reanalyze = HashSet::new();
        
        // Add modified files
        for file in &hash_comparison.modified {
            files_to_reanalyze.insert(file.file_path.clone());
        }
        
        // Add new files
        for file in &hash_comparison.added {
            files_to_reanalyze.insert(file.file_path.clone());
        }
        
        // Remove deleted files from cache
        for deleted_file in &hash_comparison.deleted {
            cached_analysis.remove(deleted_file);
        }
        
        // Filter out unchanged files that have valid cache entries
        let files_to_analyze: Vec<PathBuf> = files_to_reanalyze.into_iter()
            .filter(|file_path| {
                if let Some(cached) = cached_analysis.get(file_path) {
                    // Check if the cached result is still valid
                    if let Some(current_file) = hash_comparison.unchanged.iter()
                        .find(|f| f.file_path == *file_path) {
                        return current_file.content_hash != cached.content_hash;
                    }
                }
                true
            })
            .collect();
        
        // Perform analysis on files that need it
        let mut new_results = Vec::new();
        if !files_to_analyze.is_empty() {
            new_results = analysis_function(files_to_analyze.clone()).await?;
        }
        
        // Update cache with new results
        for result in &new_results {
            if let Some(file_info) = hash_comparison.modified.iter()
                .find(|f| f.file_path.as_path() == Path::new(&result.source))
                .or_else(|| hash_comparison.added.iter()
                    .find(|f| f.file_path.as_path() == Path::new(&result.source))) {
                
                // Build dependency graph for this file
                let dependencies = self.find_dependent_files(&[file_info.file_path.clone()], &all_files).await.unwrap_or_default();
                
                let cache_entry = AnalysisCacheEntry {
                    file_path: file_info.file_path.clone(),
                    content_hash: file_info.content_hash.clone(),
                    analysis_result: result.clone(),
                    timestamp: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    dependencies,
                };
                
                cached_analysis.insert(file_info.file_path.clone(), cache_entry);
            }
        }
        
        // Save updated cache
        self.cache_analysis_results(repo_path, &cached_analysis).await?;
        
        // Update file hashes cache
        let mut current_hashes = HashMap::new();
        for file_info in hash_comparison.modified.iter()
            .chain(hash_comparison.added.iter())
            .chain(hash_comparison.unchanged.iter()) {
            current_hashes.insert(file_info.file_path.clone(), file_info.clone());
        }
        self.cache_hashes(repo_path, &current_hashes).await?;
        
        let analysis_time = SystemTime::now()
            .duration_since(start_time)?
            .as_millis() as u64;
        
        let total_files = all_files.len();
        let cache_hit_rate = if total_files > 0 {
            (total_files - files_to_analyze.len()) as f64 / total_files as f64
        } else {
            0.0
        };
        
        Ok(IncrementalAnalysisResult {
            cached_results: cached_analysis.into_values().collect(),
            new_results,
            modified_files: files_to_analyze,
            analysis_time,
            total_files,
            cache_hit_rate,
        })
    }

    /// Find all supported files in a directory
    fn find_supported_files(&self, dir_path: &Path) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        
        for entry in WalkDir::new(dir_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path().extension().map_or(false, |ext| {
                    let ext_str = ext.to_str().unwrap_or("");
                    ext_str == "rs" || ext_str == "vy" || ext_str == "sol"
                })
            })
        {
            files.push(entry.path().to_path_buf());
        }
        
        Ok(files)
    }

    /// Clear all cache for a repository
    pub async fn clear_cache(&self, repo_path: &Path) -> Result<()> {
        let hash_file = self.cache_dir.join(format!("{}.hashes", repo_path.display()));
        let analysis_file = self.cache_dir.join(format!("{}.analysis", repo_path.display()));
        
        if hash_file.exists() {
            std::fs::remove_file(hash_file)?;
        }
        
        if analysis_file.exists() {
            std::fs::remove_file(analysis_file)?;
        }
        
        Ok(())
    }
}

impl Default for IncrementalScanner {
    fn default() -> Self {
        Self::new("./cache")
    }
}
