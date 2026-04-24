import { Injectable, Logger } from '@nestjs/common';
import { ScannerService } from '../scanner/scanner.service';
import { RuleViolation } from '../scanner/interfaces/scanner.interface';
import {
  AnalysisReport,
  StorageSavings,
  FormattedViolation,
} from './interfaces/analyzer.interface';

export interface IncrementalAnalysisOptions {
  useIncremental?: boolean;
  forceFull?: boolean;
  repoPath?: string;
  maxCacheAge?: number; // in milliseconds
}

export interface IncrementalAnalysisResult extends AnalysisReport {
  incrementalStats: {
    totalFiles: number;
    filesAnalyzed: number;
    cacheHitRate: number;
    analysisTime: number;
    isIncremental: boolean;
  };
}

@Injectable()
export class IncrementalAnalyzerService {
  private readonly logger = new Logger(IncrementalAnalyzerService.name);
  private readonly cache = new Map<string, any>();

  constructor(
    private readonly scannerService: ScannerService,
  ) {}

  /**
   * Analyze code with incremental support
   */
  async analyzeCodeIncremental(
    code: string,
    source: string,
    options: IncrementalAnalysisOptions = {}
  ): Promise<IncrementalAnalysisResult> {
    const startTime = Date.now();
    
    // For single file analysis, always use full analysis
    const result = await this.analyzeCode(code, source);
    
    return {
      ...result,
      incrementalStats: {
        totalFiles: 1,
        filesAnalyzed: 1,
        cacheHitRate: 0,
        analysisTime: Date.now() - startTime,
        isIncremental: false,
      },
    };
  }

  /**
   * Analyze repository with incremental support
   */
  async analyzeRepositoryIncremental(
    repoPath: string,
    options: IncrementalAnalysisOptions = {}
  ): Promise<IncrementalAnalysisResult> {
    const startTime = Date.now();
    const useIncremental = options.useIncremental !== false && !options.forceFull;
    
    try {
      // Find all supported files in the repository
      const allFiles = await this.findSupportedFiles(repoPath);
      
      this.logger.log(`Found ${allFiles.length} supported files in repository`);
      
      if (!useIncremental || allFiles.length <= 10) {
        // Use full analysis for small repositories or when incremental is disabled
        return this.performFullAnalysis(repoPath, allFiles, startTime);
      }
      
      // Check if incremental analysis should be used
      const shouldUseIncremental = await this.incrementalCacheService.shouldUseIncrementalAnalysis(
        repoPath,
        allFiles.length
      );
      
      if (!shouldUseIncremental) {
        this.logger.log('Using full analysis (incremental not beneficial)');
        return this.performFullAnalysis(repoPath, allFiles, startTime);
      }
      
      // Perform incremental analysis
      return this.performIncrementalAnalysis(repoPath, allFiles, startTime, options);
      
    } catch (error) {
      this.logger.error(`Repository analysis failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Perform full analysis on all files
   */
  private async performFullAnalysis(
    repoPath: string,
    files: string[],
    startTime: number
  ): Promise<IncrementalAnalysisResult> {
    this.logger.log(`Performing full analysis on ${files.length} files`);
    
    const allViolations: RuleViolation[] = [];
    const analysisTime = Date.now() - startTime;
    
    // Analyze files in batches to avoid overwhelming the system
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      for (const filePath of batch) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const scanResult = await this.scannerService.scanContent(content, filePath);
          allViolations.push(...scanResult.violations);
        } catch (error) {
          this.logger.warn(`Failed to analyze file ${filePath}: ${error.message}`);
        }
      }
    }
    
    const report = this.createAnalysisReport(repoPath, allViolations);
    
    return {
      ...report,
      incrementalStats: {
        totalFiles: files.length,
        filesAnalyzed: files.length,
        cacheHitRate: 0,
        analysisTime,
        isIncremental: false,
      },
    };
  }

  /**
   * Perform incremental analysis
   */
  private async performIncrementalAnalysis(
    repoPath: string,
    allFiles: string[],
    startTime: number,
    options: IncrementalAnalysisOptions
  ): Promise<IncrementalAnalysisResult> {
    this.logger.log(`Performing incremental analysis on ${allFiles.length} files`);
    
    try {
      const incrementalResult = await this.incrementalCacheService.performIncrementalAnalysis(
        repoPath,
        allFiles,
        async (filesToAnalyze: string[]) => {
          const results = [];
          
          for (const filePath of filesToAnalyze) {
            try {
              const content = await fs.readFile(filePath, 'utf-8');
              const scanResult = await this.scannerService.scanContent(content, filePath);
              results.push(scanResult);
            } catch (error) {
              this.logger.warn(`Failed to analyze file ${filePath}: ${error.message}`);
            }
          }
          
          return results;
        }
      );
      
      // Combine cached and new results
      const allViolations: RuleViolation[] = [];
      
      // Add cached results
      for (const cachedEntry of incrementalResult.cachedResults) {
        allViolations.push(...cachedEntry.analysisResult.violations);
      }
      
      // Add new results
      for (const newResult of incrementalResult.newResults) {
        allViolations.push(...newResult.violations);
      }
      
      const report = this.createAnalysisReport(repoPath, allViolations);
      
      return {
        ...report,
        incrementalStats: {
          totalFiles: incrementalResult.totalFiles,
          filesAnalyzed: incrementalResult.modifiedFiles.length,
          cacheHitRate: incrementalResult.cacheHitRate,
          analysisTime: incrementalResult.analysisTime,
          isIncremental: true,
        },
      };
      
    } catch (error) {
      this.logger.error(`Incremental analysis failed, falling back to full analysis: ${error.message}`);
      // Fallback to full analysis
      return this.performFullAnalysis(repoPath, allFiles, startTime);
    }
  }

  /**
   * Create analysis report from violations
   */
  private createAnalysisReport(repoPath: string, violations: RuleViolation[]): AnalysisReport {
    const formattedViolations = this.formatViolations(violations);
    const storageSavings = this.calculateStorageSavingsFromViolations(violations);

    return {
      source: repoPath,
      analysisTime: new Date().toISOString(),
      violations: formattedViolations,
      summary: this.generateSummary(violations),
      storageSavings,
      recommendations: this.generateRecommendations(violations),
    };
  }

  /**
   * Find all supported files in a directory
   */
  private async findSupportedFiles(repoPath: string): Promise<string[]> {
    const supportedExtensions = ['.rs', '.sol', '.vy'];
    const files: string[] = [];
    
    const walkDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory()) {
            // Skip common directories that don't contain source code
            if (['node_modules', '.git', 'target', 'dist', 'build'].includes(entry.name)) {
              continue;
            }
            await walkDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (supportedExtensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };
    
    await walkDirectory(repoPath);
    return files;
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
    return this.incrementalCacheService.getCacheStats(repoPath);
  }

  /**
   * Clear incremental analysis cache for a repository
   */
  async clearCache(repoPath: string): Promise<void> {
    await this.incrementalCacheService.clearCache(repoPath);
    this.logger.log(`Cleared incremental analysis cache for ${repoPath}`);
  }

  /**
   * Invalidate cache for specific files
   */
  async invalidateFiles(repoPath: string, filePaths: string[]): Promise<void> {
    await this.incrementalCacheService.invalidateFiles(repoPath, filePaths);
    this.logger.log(`Invalidated cache for ${filePaths.length} files`);
  }

  /**
   * Legacy method for backward compatibility
   */
  private async analyzeCode(code: string, source: string): Promise<AnalysisReport> {
    const scanResult = await this.scannerService.scanContent(code, source);
    const formattedViolations = this.formatViolations(scanResult.violations);
    const storageSavings = this.calculateStorageSavingsFromViolations(scanResult.violations);

    return {
      source,
      analysisTime: new Date().toISOString(),
      violations: formattedViolations,
      summary: this.generateSummary(scanResult.violations),
      storageSavings,
      recommendations: this.generateRecommendations(scanResult.violations),
    };
  }

  private formatViolations(violations: RuleViolation[]): FormattedViolation[] {
    return violations.map((violation) => ({
      ...violation,
      severityIcon: this.getSeverityIcon(violation.severity),
      formattedMessage: this.formatViolationMessage(violation),
    }));
  }

  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'error':
        return '🚨';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📝';
    }
  }

  private formatViolationMessage(violation: RuleViolation): string {
    return `[${violation.severity.toUpperCase()}] Line ${violation.lineNumber}: ${violation.description}`;
  }

  private generateSummary(violations: RuleViolation[]): string {
    if (violations.length === 0) {
      return '✅ No violations found! Your contract is optimized.';
    }

    const errors = violations.filter((v) => v.severity === 'error').length;
    const warnings = violations.filter((v) => v.severity === 'warning').length;
    const info = violations.filter((v) => v.severity === 'info').length;

    return `Scan Summary: ${violations.length} total violations (${errors} errors, ${warnings} warnings, ${info} info)`;
  }

  private calculateStorageSavingsFromViolations(violations: RuleViolation[]): StorageSavings {
    let unusedVariables = 0;
    let estimatedSavingsKb = 0;

    for (const violation of violations) {
      if (violation.ruleName === 'unused-state-variables') {
        unusedVariables++;
        estimatedSavingsKb += 2.5;
      }
    }

    return {
      unusedVariables,
      estimatedSavingsKb,
      monthlyLedgerRentSavings: estimatedSavingsKb * 0.001,
    };
  }

  private generateRecommendations(violations: RuleViolation[]): string[] {
    const recommendations: string[] = [];
    const unusedVars = violations.filter(
      (v) => v.ruleName === 'unused-state-variables',
    ).length;

    if (unusedVars > 0) {
      recommendations.push(
        `Remove ${unusedVars} unused state variables to reduce storage costs`,
      );
      recommendations.push(
        'Consider using more efficient data types where possible',
      );
      recommendations.push(
        'Implement lazy loading patterns for rarely accessed data',
      );
    }

    if (violations.length === 0) {
      recommendations.push(
        'Your contract looks good! Consider regular audits to maintain code quality.',
      );
    }

    return recommendations;
  }
}
