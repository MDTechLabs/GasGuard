import { CacheService } from './cache.service';
import { FileHashService, FileHashInfo, HashComparisonResult } from './file-hash.service';

export interface AnalysisCacheEntry {
  filePath: string;
  contentHash: string;
  analysisResult: any; // AnalysisResult type from engine
  timestamp: number;
  dependencies: string[]; // Files this analysis depends on
}

export interface IncrementalAnalysisResult {
  cachedResults: AnalysisCacheEntry[];
  newResults: any[]; // AnalysisResult type from engine
  modifiedFiles: string[];
  analysisTime: number;
  totalFiles: number;
  cacheHitRate: number;
}

export interface DependencyGraph {
  nodes: Map<string, Set<string>>; // file -> dependencies
  reverseNodes: Map<string, Set<string>>; // file -> dependents
}

export class IncrementalCacheService {
  private dependencyGraph: DependencyGraph = {
    nodes: new Map(),
    reverseNodes: new Map(),
  };

  constructor(
    private cacheService: CacheService,
    private fileHashService: FileHashService
  ) {}

  /**
   * Get cached analysis results for a repository
   */
  async getCachedAnalysis(repoPath: string): Promise<Map<string, AnalysisCacheEntry>> {
    const cacheKey = `analysis-cache:${this.normalizeRepoPath(repoPath)}`;
    const cached = await this.cacheService.get<Record<string, AnalysisCacheEntry>>(cacheKey);
    
    if (!cached) {
      return new Map();
    }
    
    return new Map(Object.entries(cached));
  }

  /**
   * Cache analysis results for a repository
   */
  async cacheAnalysisResults(
    repoPath: string,
    results: Map<string, AnalysisCacheEntry>
  ): Promise<void> {
    const cacheKey = `analysis-cache:${this.normalizeRepoPath(repoPath)}`;
    const resultObject = Object.fromEntries(results);
    await this.cacheService.set(cacheKey, resultObject, 86400); // 24 hours TTL
  }

  /**
   * Get cached dependency graph for a repository
   */
  async getCachedDependencyGraph(repoPath: string): Promise<DependencyGraph> {
    const cacheKey = `dependency-graph:${this.normalizeRepoPath(repoPath)}`;
    const cached = await this.cacheService.get<{
      nodes: Record<string, string[]>;
      reverseNodes: Record<string, string[]>;
    }>(cacheKey);
    
    if (!cached) {
      return {
        nodes: new Map(),
        reverseNodes: new Map(),
      };
    }
    
    return {
      nodes: new Map(Object.entries(cached.nodes).map(([k, v]) => [k, new Set(v)])),
      reverseNodes: new Map(Object.entries(cached.reverseNodes).map(([k, v]) => [k, new Set(v)])),
    };
  }

  /**
   * Cache dependency graph for a repository
   */
  async cacheDependencyGraph(repoPath: string, graph: DependencyGraph): Promise<void> {
    const cacheKey = `dependency-graph:${this.normalizeRepoPath(repoPath)}`;
    const serializableGraph = {
      nodes: Object.fromEntries(Array.from(graph.nodes.entries()).map(([k, v]) => [k, Array.from(v)])),
      reverseNodes: Object.fromEntries(Array.from(graph.reverseNodes.entries()).map(([k, v]) => [k, Array.from(v)])),
    };
    await this.cacheService.set(cacheKey, serializableGraph, 86400); // 24 hours TTL
  }

  /**
   * Perform incremental analysis
   */
  async performIncrementalAnalysis(
    repoPath: string,
    allFiles: string[],
    analysisFunction: (files: string[]) => Promise<any[]>
  ): Promise<IncrementalAnalysisResult> {
    const startTime = Date.now();
    
    // Filter supported files
    const supportedFiles = this.fileHashService.filterSupportedFiles(allFiles);
    
    // Get hash comparison
    const hashComparison = await this.fileHashService.compareWithCache(repoPath, supportedFiles);
    
    // Get cached analysis results
    const cachedAnalysis = await this.getCachedAnalysis(repoPath);
    
    // Get dependency graph
    const dependencyGraph = await this.getCachedDependencyGraph(repoPath);
    
    // Determine which files need re-analysis
    const filesToReanalyze = new Set<string>();
    
    // Add modified files
    hashComparison.modified.forEach(file => filesToReanalyze.add(file.filePath));
    
    // Add files that depend on modified files
    for (const modifiedFile of hashComparison.modified) {
      const dependents = dependencyGraph.reverseNodes.get(modifiedFile.filePath);
      if (dependents) {
        dependents.forEach(dependent => filesToReanalyze.add(dependent));
      }
    }
    
    // Add new files
    hashComparison.added.forEach(file => filesToReanalyze.add(file.filePath));
    
    // Remove deleted files from cache
    hashComparison.deleted.forEach(deletedFile => {
      cachedAnalysis.delete(deletedFile);
    });
    
    // Filter out unchanged files that have valid cache entries
    const filesToAnalyze = Array.from(filesToReanalyze).filter(filePath => {
      const cached = cachedAnalysis.get(filePath);
      if (!cached) return true;
      
      // Check if the cached result is still valid
      const currentFile = hashComparison.unchanged.find(f => f.filePath === filePath);
      return !currentFile || currentFile.contentHash !== cached.contentHash;
    });
    
    // Perform analysis on files that need it
    let newResults: any[] = [];
    if (filesToAnalyze.length > 0) {
      newResults = await analysisFunction(filesToAnalyze);
    }
    
    // Update cache with new results
    for (const result of newResults) {
      const fileInfo = hashComparison.modified.find(f => f.filePath === result.source) ||
                       hashComparison.added.find(f => f.filePath === result.source);
      
      if (fileInfo) {
        // Build dependency graph for this file
        const dependencies = await this.fileHashService.findDependentFiles([fileInfo.filePath], supportedFiles);
        
        const cacheEntry: AnalysisCacheEntry = {
          filePath: fileInfo.filePath,
          contentHash: fileInfo.contentHash,
          analysisResult: result,
          timestamp: Date.now(),
          dependencies,
        };
        
        cachedAnalysis.set(fileInfo.filePath, cacheEntry);
        
        // Update dependency graph
        dependencyGraph.nodes.set(fileInfo.filePath, new Set(dependencies));
        dependencies.forEach(dep => {
          if (!dependencyGraph.reverseNodes.has(dep)) {
            dependencyGraph.reverseNodes.set(dep, new Set());
          }
          dependencyGraph.reverseNodes.get(dep)!.add(fileInfo.filePath);
        });
      }
    }
    
    // Save updated cache and dependency graph
    await this.cacheAnalysisResults(repoPath, cachedAnalysis);
    await this.cacheDependencyGraph(repoPath, dependencyGraph);
    
    // Update file hashes cache
    const currentHashes = new Map<string, FileHashInfo>();
    [...hashComparison.modified, ...hashComparison.added, ...hashComparison.unchanged]
      .forEach(fileInfo => currentHashes.set(fileInfo.filePath, fileInfo));
    await this.fileHashService.cacheHashes(repoPath, currentHashes);
    
    const analysisTime = Date.now() - startTime;
    const totalFiles = supportedFiles.length;
    const cacheHitRate = (totalFiles - filesToAnalyze.length) / totalFiles;
    
    return {
      cachedResults: Array.from(cachedAnalysis.values()),
      newResults,
      modifiedFiles: filesToAnalyze,
      analysisTime,
      totalFiles,
      cacheHitRate,
    };
  }

  /**
   * Invalidate cache for specific files
   */
  async invalidateFiles(repoPath: string, filePaths: string[]): Promise<void> {
    const cachedAnalysis = await this.getCachedAnalysis(repoPath);
    
    filePaths.forEach(filePath => {
      cachedAnalysis.delete(filePath);
    });
    
    await this.cacheAnalysisResults(repoPath, cachedAnalysis);
  }

  /**
   * Clear all incremental analysis cache for a repository
   */
  async clearCache(repoPath: string): Promise<void> {
    const normalizedPath = this.normalizeRepoPath(repoPath);
    
    await Promise.all([
      this.cacheService.del(`analysis-cache:${normalizedPath}`),
      this.cacheService.del(`dependency-graph:${normalizedPath}`),
      this.cacheService.del(`file-hashes:${normalizedPath}`),
    ]);
  }

  /**
   * Get cache statistics for a repository
   */
  async getCacheStats(repoPath: string): Promise<{
    totalCachedFiles: number;
    cacheAge: number | null;
    dependencyNodes: number;
    dependencyEdges: number;
  }> {
    const cachedAnalysis = await this.getCachedAnalysis(repoPath);
    const dependencyGraph = await this.getCachedDependencyGraph(repoPath);
    
    let cacheAge = null;
    if (cachedAnalysis.size > 0) {
      const oldestEntry = Array.from(cachedAnalysis.values())
        .reduce((oldest, current) => current.timestamp < oldest.timestamp ? current : oldest);
      cacheAge = Date.now() - oldestEntry.timestamp;
    }
    
    let dependencyEdges = 0;
    dependencyGraph.nodes.forEach(deps => {
      dependencyEdges += deps.size;
    });
    
    return {
      totalCachedFiles: cachedAnalysis.size,
      cacheAge,
      dependencyNodes: dependencyGraph.nodes.size,
      dependencyEdges,
    };
  }

  /**
   * Normalize repository path for consistent caching
   */
  private normalizeRepoPath(repoPath: string): string {
    return repoPath.replace(/\\/g, ':').replace(/\//g, ':');
  }

  /**
   * Check if incremental analysis is beneficial for this repository
   */
  async shouldUseIncrementalAnalysis(repoPath: string, fileCount: number): Promise<boolean> {
    // Use incremental analysis if:
    // 1. There are more than 10 files
    // 2. We have some cached data
    // 3. The cache is not too old (older than 7 days)
    
    if (fileCount <= 10) {
      return false;
    }
    
    const stats = await this.getCacheStats(repoPath);
    
    if (stats.totalCachedFiles === 0) {
      return false;
    }
    
    if (stats.cacheAge && stats.cacheAge > 7 * 24 * 60 * 60 * 1000) { // 7 days
      return false;
    }
    
    return true;
  }
}
