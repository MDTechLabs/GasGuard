import { annotateFindings } from "./finding-metadata";

export enum Severity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

export interface Finding {
  ruleId: string;
  message: string;
  severity: Severity;
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };

  estimatedGasSavings?: number;

  suggestedFix?: {
    description: string;
    codeSnippet?: string;
    documentationUrl?: string;
  };

  metadata?: Record<string, any>;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  category: string;
  enabled: boolean;
  tags?: string[];
  documentationUrl?: string;

  estimatedGasImpact?: {
    min: number;
    max: number;
    typical: number;
  };
}

export interface AnalyzerCapabilities {
  /** Supports incremental file-level analysis with caching */
  incremental?: boolean;
  /** Supports restricting analysis to changed files */
  changedFilesOnly?: boolean;
  /** Supports reporting memory usage metrics */
  memoryReporting?: boolean;
  /** Supports analyzing multiple files in batches */
  batchAnalysis?: boolean;
  /** Supports providing suggested fixes */
  quickFix?: boolean;
  /** Supports configurable rules */
  configurableRules?: boolean;
  /** Languages supported by this analyzer */
  languages?: Language[];
  /** Arbitrary analyzer capabilities */
  [key: string]: any;
}

export interface MemoryUsage {
  /** Heap memory used in bytes */
  heapUsed: number;
  /** Total heap memory allocated in bytes */
  heapTotal: number;
  /** Resident Set Size in bytes */
  rss: number;
  /** External memory in bytes */
  external?: number;
  /** Net change in heap used during execution in bytes */
  delta?: number;
}

export interface IncrementalAnalysisStats {
  /** Number of files served from cache without re-analysis */
  cachedFiles: number;
  /** Number of files that had to be analyzed */
  analyzedFiles: number;
  /** Total number of files evaluated */
  totalFiles: number;
}

export interface FileAnalysisCacheEntry {
  hash: string;
  findings: Finding[];
  totalEstimatedGasSavings?: number;
  timestamp: number;
}

export interface AnalyzerConfig {
  rules?: {
    [ruleId: string]:
      | boolean
      | {
          enabled: boolean;
          severity?: Severity;
          options?: Record<string, any>;
        };
  };

  excludePaths?: string[];
  includePaths?: string[];
  maxFindings?: number;
  options?: Record<string, any>;

  /** When true, report memory usage in the analysis result */
  reportMemoryUsage?: boolean;

  /** When true, use incremental file-level caching to skip unchanged files */
  incremental?: boolean;

  /** When true, restrict analysis to changed files */
  changedFilesOnly?: boolean;

  /** Explicit list of changed file paths to analyze when changedFilesOnly is true */
  changedFiles?: string[];
}

export interface AnalysisResult {
  findings: Finding[];
  filesAnalyzed: number;
  analysisTime: number;
  analyzerVersion: string;

  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };

  totalEstimatedGasSavings?: number;

  /** Any errors or warnings during analysis */
  errors?: Array<{
    file: string;
    message: string;
    error?: Error;
  }>;

  /** Memory usage stats during analysis (when reportMemoryUsage is true) */
  memoryUsage?: MemoryUsage;

  /** Incremental analysis stats (when incremental is true) */
  incremental?: IncrementalAnalysisStats;
}

export enum Language {
  SOLIDITY = "solidity",
  VYPER = "vyper",
  RUST = "rust",
  SOROBAN = "soroban",
  CAIRO = "cairo",
  MOVE = "move",
  JAVASCRIPT = "javascript",
  TYPESCRIPT = "typescript",
}

export interface Analyzer {
  getName(): string;
  getVersion(): string;

  analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult>;

  analyzeMultiple(
    files: Map<string, string>,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult>;

  supportsLanguage(language: Language | string): boolean;

  getSupportedLanguages(): Language[];

  /** Names of analyzers that must run before this analyzer. */
  getDependencies?(): string[];

  /** Discovers or returns capabilities supported by this analyzer. */
  getCapabilities?(): AnalyzerCapabilities;

  getRules(): Rule[];

  getRule(ruleId: string): Rule | undefined;

  validateConfig(config: AnalyzerConfig): string[];

  initialize(config?: AnalyzerConfig): Promise<void>;

  dispose(): Promise<void>;

  /** Clears any cached file analysis entries */
  clearCache?(): void;
}

export abstract class BaseAnalyzer implements Analyzer {
  protected config: AnalyzerConfig = {};
  protected initialized = false;
  protected fileCache: Map<string, FileAnalysisCacheEntry> = new Map();

  abstract getName(): string;
  abstract getVersion(): string;
  abstract analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult>;
  abstract supportsLanguage(language: Language | string): boolean;
  abstract getSupportedLanguages(): Language[];
  abstract getRules(): Rule[];

  getCapabilities(): AnalyzerCapabilities {
    return {
      batchAnalysis: true,
      incremental: true,
      changedFilesOnly: true,
      memoryReporting: true,
      quickFix: false,
      configurableRules: true,
      languages: this.getSupportedLanguages(),
    };
  }

  clearCache(): void {
    this.fileCache.clear();
  }

  getCacheSize(): number {
    return this.fileCache.size;
  }

  protected computeHash(content: string): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require("crypto");
      return crypto.createHash("sha256").update(content).digest("hex");
    } catch {
      let hash = 5381;
      for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
      }
      return (hash >>> 0).toString(16);
    }
  }

  protected captureMemoryUsage(startMemory?: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external?: number;
  }): MemoryUsage | undefined {
    if (typeof process === "undefined" || !process.memoryUsage) {
      return undefined;
    }
    const current = process.memoryUsage();
    return {
      heapUsed: current.heapUsed,
      heapTotal: current.heapTotal,
      rss: current.rss,
      external: current.external,
      delta: startMemory ? current.heapUsed - startMemory.heapUsed : undefined,
    };
  }

  protected normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  async analyzeMultiple(
    files: Map<string, string>,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult> {
    const cfg = config || this.config;
    const startTime = Date.now();
    const startMemory =
      cfg.reportMemoryUsage &&
      typeof process !== "undefined" &&
      process.memoryUsage
        ? process.memoryUsage()
        : undefined;

    const allFindings: Finding[] = [];
    const errors: Array<{ file: string; message: string; error?: Error }> = [];
    let cachedFilesCount = 0;
    let analyzedFilesCount = 0;

    for (const [filePath, code] of files.entries()) {
      if (!this.shouldAnalyzeFile(filePath, cfg)) {
        continue;
      }

      const normPath = this.normalizePath(filePath);

      if (cfg.incremental) {
        const hash = this.computeHash(code);
        const cached = this.fileCache.get(normPath);
        if (cached && cached.hash === hash) {
          allFindings.push(...cached.findings);
          cachedFilesCount++;
          continue;
        }
      }

      try {
        const result = await this.analyze(code, filePath, cfg);
        allFindings.push(...result.findings);
        if (result.errors) {
          errors.push(...result.errors);
        }
        analyzedFilesCount++;

        if (cfg.incremental) {
          this.fileCache.set(normPath, {
            hash: this.computeHash(code),
            findings: result.findings,
            totalEstimatedGasSavings: result.totalEstimatedGasSavings,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        errors.push({
          file: filePath,
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error : undefined,
        });
      }
    }

    // Opt-in: fingerprints and provenance are added only when requested, so existing result
    // shapes and golden snapshots are unchanged by default.
    if (cfg.options?.findingMetadata === true) {
      annotateFindings(allFindings, files, {
        sourceMaps: cfg.options?.sourceMaps,
        includePathInFingerprint: cfg.options?.includePathInFingerprint === true,
      });
    }

    const analysisTime = Date.now() - startTime;
    const memoryUsage = cfg.reportMemoryUsage
      ? this.captureMemoryUsage(startMemory)
      : undefined;

    return {
      findings: allFindings,
      filesAnalyzed: analyzedFilesCount + cachedFilesCount,
      analysisTime,
      analyzerVersion: this.getVersion(),
      summary: this.calculateSummary(allFindings),
      totalEstimatedGasSavings: this.calculateTotalGasSavings(allFindings),
      errors: errors.length > 0 ? errors : undefined,
      memoryUsage,
      incremental: cfg.incremental
        ? {
            cachedFiles: cachedFilesCount,
            analyzedFiles: analyzedFilesCount,
            totalFiles: files.size,
          }
        : undefined,
    };
  }

  getRule(ruleId: string): Rule | undefined {
    return this.getRules().find((rule) => rule.id === ruleId);
  }

  validateConfig(config: AnalyzerConfig): string[] {
    const errors: string[] = [];

    if (config.rules) {
      const availableRules = new Set(this.getRules().map((r) => r.id));
      for (const ruleId of Object.keys(config.rules)) {
        if (!availableRules.has(ruleId)) {
          errors.push(`Unknown rule: ${ruleId}`);
        }
      }
    }

    return errors;
  }

  async initialize(config?: AnalyzerConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (config) {
      const errors = this.validateConfig(config);
      if (errors.length > 0) {
        throw new Error(`Invalid configuration: ${errors.join(", ")}`);
      }
      this.config = config;
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
    this.fileCache.clear();
  }

  protected calculateSummary(findings: Finding[]): AnalysisResult["summary"] {
    return {
      critical: findings.filter((f) => f.severity === Severity.CRITICAL).length,
      high: findings.filter((f) => f.severity === Severity.HIGH).length,
      medium: findings.filter((f) => f.severity === Severity.MEDIUM).length,
      low: findings.filter((f) => f.severity === Severity.LOW).length,
      info: findings.filter((f) => f.severity === Severity.INFO).length,
    };
  }

  protected calculateTotalGasSavings(findings: Finding[]): number | undefined {
    const savings = findings
      .map((f) => f.estimatedGasSavings || 0)
      .reduce((sum, val) => sum + val, 0);

    return savings > 0 ? savings : undefined;
  }

  protected shouldAnalyzeFile(
    filePath: string,
    config?: AnalyzerConfig,
  ): boolean {
    const cfg = config || this.config;

    if (cfg.changedFilesOnly) {
      const changed = (cfg.changedFiles ?? []).map((p) =>
        this.normalizePath(p),
      );
      const normPath = this.normalizePath(filePath);
      if (!changed.includes(normPath)) {
        return false;
      }
    }

    if (cfg.includePaths && cfg.includePaths.length > 0) {
      if (
        !cfg.includePaths.some((pattern) =>
          this.matchesPattern(filePath, pattern),
        )
      ) {
        return false;
      }
    }

    // Rules are evaluated in declaration order. A later match wins and a
    // leading `!` re-includes a path ignored by an earlier rule.
    let ignored = false;
    for (const rawPattern of cfg.excludePaths ?? []) {
      const negated = rawPattern.startsWith("!");
      const pattern = negated ? rawPattern.slice(1) : rawPattern;
      if (pattern && this.matchesPattern(filePath, pattern)) {
        ignored = !negated;
      }
    }
    return !ignored;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    const normalizedPath = this.normalizePath(path);
    const normalizedPattern = this.normalizePath(pattern);
    const anchored = normalizedPattern.startsWith("/");
    const source = normalizedPattern
      .replace(/^\//, "")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, ".*");
    return new RegExp(`${anchored ? "^" : "(?:^|.*/)"}${source}(?:$|/)`).test(
      normalizedPath,
    );
  }
}
