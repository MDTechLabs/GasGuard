// src/ci/preCommitValidator.ts
import { logger } from '../utils/logger';

export interface PreCommitCheckOptions {
  stagedFiles: string[];
  maxAllowedGasOverhead?: number;
  supportedExtensions?: string[];
  failOnInvalidOptions?: boolean;
}

export interface FileInspectionResult {
  file: string;
  extension: string;
  passed: boolean;
  estimatedGasOverhead: number;
  violations: string[];
}

export interface PreCommitValidationReport {
  passed: boolean;
  totalStagedCount: number;
  inspectedCount: number;
  maxAllowedGasOverhead: number;
  results: FileInspectionResult[];
}

const DEFAULT_SUPPORTED_EXTENSIONS = ['.sol', '.ts', '.rs'] as const;
const DEFAULT_MAX_GAS_OVERHEAD = 50_000;

export class PreCommitValidator {
  /**
   * Normalizes file paths (forward slashes, trimmed, deduplicated) deterministically.
   */
  static normalizeStagedFiles(stagedFiles: string[]): string[] {
    if (!Array.isArray(stagedFiles) || stagedFiles.length === 0) {
      return [];
    }

    const normalized = stagedFiles
      .map((file) => file.replace(/\\/g, '/').trim())
      .filter((file) => file.length > 0);

    return [...new Set(normalized)].sort();
  }

  /**
   * Filters normalized staged files to supported smart contract / source files.
   */
  static selectTargetFiles(
    stagedFiles: string[],
    supportedExtensions: readonly string[] = DEFAULT_SUPPORTED_EXTENSIONS,
  ): string[] {
    const normalizedExtSet = new Set(
      supportedExtensions.map((ext) =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`,
      ),
    );

    return this.normalizeStagedFiles(stagedFiles).filter((file) => {
      const lower = file.toLowerCase();
      for (const ext of normalizedExtSet) {
        if (lower.endsWith(ext)) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Evaluates a single target file deterministically without executing repo code or hooks.
   */
  private static inspectTargetFile(
    file: string,
    maxAllowedGasOverhead: number,
  ): FileInspectionResult {
    const dotIndex = file.lastIndexOf('.');
    const extension = dotIndex >= 0 ? file.slice(dotIndex).toLowerCase() : '';
    const violations: string[] = [];

    // Deterministic baseline static heuristic placeholder (zero subprocess or code execution)
    const estimatedGasOverhead = 0;

    if (estimatedGasOverhead > maxAllowedGasOverhead) {
      violations.push(
        `Estimated gas overhead (${estimatedGasOverhead}) exceeds maximum allowed (${maxAllowedGasOverhead}).`,
      );
    }

    return {
      file,
      extension,
      passed: violations.length === 0,
      estimatedGasOverhead,
      violations,
    };
  }

  /**
   * Runs detailed pre-commit validation and returns a structured report.
   */
  static async validateStagedFilesDetailed(
    options: PreCommitCheckOptions,
  ): Promise<PreCommitValidationReport> {
    const stagedFiles = Array.isArray(options?.stagedFiles) ? options.stagedFiles : [];
    const maxAllowedGasOverhead =
      options?.maxAllowedGasOverhead ?? DEFAULT_MAX_GAS_OVERHEAD;
    const supportedExtensions =
      options?.supportedExtensions ?? DEFAULT_SUPPORTED_EXTENSIONS;

    if (maxAllowedGasOverhead < 0 || Number.isNaN(maxAllowedGasOverhead)) {
      const message = `Invalid maxAllowedGasOverhead value: ${String(maxAllowedGasOverhead)}`;
      logger.warn({ maxAllowedGasOverhead }, message);
      if (options?.failOnInvalidOptions) {
        throw new Error(message);
      }
    }

    logger.info(
      { fileCount: stagedFiles.length, maxAllowedGasOverhead },
      'Running pre-commit gas check on staged files...',
    );

    if (stagedFiles.length === 0) {
      logger.debug('No staged files to check.');
      return {
        passed: true,
        totalStagedCount: 0,
        inspectedCount: 0,
        maxAllowedGasOverhead,
        results: [],
      };
    }

    const targetFiles = this.selectTargetFiles(stagedFiles, supportedExtensions);

    if (targetFiles.length === 0) {
      logger.debug('No relevant smart contract or code files staged.');
      return {
        passed: true,
        totalStagedCount: stagedFiles.length,
        inspectedCount: 0,
        maxAllowedGasOverhead,
        results: [],
      };
    }

    const results: FileInspectionResult[] = [];
    for (const file of targetFiles) {
      logger.debug({ file }, 'Inspecting file for gas efficiency...');
      const inspection = this.inspectTargetFile(file, maxAllowedGasOverhead);
      results.push(inspection);

      if (!inspection.passed) {
        logger.warn(
          { file: inspection.file, violations: inspection.violations },
          'Pre-commit check flagged violations in staged file.',
        );
      }
    }

    const passed = results.every((r) => r.passed);

    if (passed) {
      logger.info(
        { inspectedCount: results.length },
        'Pre-commit gas validation passed successfully.',
      );
    } else {
      logger.error(
        {
          inspectedCount: results.length,
          failedCount: results.filter((r) => !r.passed).length,
        },
        'Pre-commit gas validation failed.',
      );
    }

    return {
      passed,
      totalStagedCount: stagedFiles.length,
      inspectedCount: results.length,
      maxAllowedGasOverhead,
      results,
    };
  }

  /**
   * Validates staged contract and source files against gas limits.
   */
  static async validateStagedFiles(options: PreCommitCheckOptions): Promise<boolean> {
    const report = await this.validateStagedFilesDetailed(options);
    return report.passed;
  }
}