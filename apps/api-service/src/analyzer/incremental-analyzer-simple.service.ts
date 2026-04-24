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
export class IncrementalAnalyzerSimpleService {
  private readonly logger = new Logger(IncrementalAnalyzerSimpleService.name);
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
      // For now, implement a simple version that always does full analysis
      // This can be enhanced later with proper incremental functionality
      this.logger.log(`Performing repository analysis for: ${repoPath}`);
      
      // Simulate finding files (in real implementation, this would scan the directory)
      const files = await this.findSupportedFiles(repoPath);
      
      if (!useIncremental || files.length <= 10) {
        return this.performFullAnalysis(repoPath, files, startTime);
      }
      
      // For now, fallback to full analysis
      // TODO: Implement proper incremental analysis with file hashing
      return this.performFullAnalysis(repoPath, files, startTime);
      
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
    
    // Analyze files in batches
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      for (const filePath of batch) {
        try {
          // In a real implementation, this would read the file content
          // For now, we'll simulate the analysis
          const scanResult = await this.scannerService.scanContent('', filePath);
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
   * Find all supported files in a directory (simplified version)
   */
  private async findSupportedFiles(repoPath: string): Promise<string[]> {
    // This is a simplified implementation
    // In a real scenario, this would use fs.readdir and fs.stat to walk the directory
    const supportedExtensions = ['.rs', '.sol', '.vy'];
    
    // For now, return an empty array as a placeholder
    // In a real implementation, this would scan the directory recursively
    this.logger.log(`Scanning for supported files in ${repoPath}`);
    
    return [];
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
    // Simplified cache stats
    return {
      totalCachedFiles: this.cache.size,
      cacheAge: null,
      dependencyNodes: 0,
      dependencyEdges: 0,
    };
  }

  /**
   * Clear incremental analysis cache for a repository
   */
  async clearCache(repoPath: string): Promise<void> {
    // Clear cache entries for this repository
    const keysToDelete = Array.from(this.cache.keys()).filter(key => key.includes(repoPath));
    keysToDelete.forEach(key => this.cache.delete(key));
    
    this.logger.log(`Cleared incremental analysis cache for ${repoPath}`);
  }

  /**
   * Invalidate cache for specific files
   */
  async invalidateFiles(repoPath: string, filePaths: string[]): Promise<void> {
    // Invalidate specific file cache entries
    filePaths.forEach(filePath => {
      const key = `${repoPath}:${filePath}`;
      this.cache.delete(key);
    });
    
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
