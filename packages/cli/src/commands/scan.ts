import { Command } from "commander";
import chalk from "chalk";
import { randomUUID } from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  generateJsonReport,
  type ScanResult,
} from "../reporting/json-reporter";
import { generateSarifReport } from "../reporting/sarif-reporter";
import { generateGitLabReport } from "../reporting/gitlab-reporter";
import { printSummary } from "../reporting/summary-printer";
import { SolidityAnalyzer } from "../../../../libs/engine/analyzers/solidity-analyzer";
import { RustAnalyzer } from "../../../../libs/engine/analyzers/rust-analyzer";
import type {
  Analyzer,
  Finding as EngineFinding,
} from "../../../../libs/engine/core/analyzer-interface";
import { ScanWatcher } from "../../../../src/analysis/watch/watcher";
import { globIterate } from "glob";
import { loadCliConfig } from "../config/config-loader";
import {
  finishProgress,
  getCliOptions,
  logInfo,
  startProgress,
} from "../output";

export interface ScanCommandOptions {
  output?: string;
  format?: "json" | "sarif" | "gitlab" | "text" | "both";
  summary?: boolean;
  fixPreview?: boolean;
  watch?: boolean;
  config?: string;
  confidence?: string;
  maxFiles?: number;
  maxBytes?: number;
}

export const DEFAULT_MAX_FILES = 10_000;
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export class RepositoryAnalysisError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ANALYSIS_CANCELLED"
      | "FILE_LIMIT_EXCEEDED"
      | "SIZE_LIMIT_EXCEEDED",
  ) {
    super(message);
    this.name = "RepositoryAnalysisError";
  }
}

function parsePositiveLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Limit must be a positive safe integer.");
  }
  return parsed;
}

export const scanCommand = new Command("scan")
  .alias("analyze-local")
  .description("Scan smart contracts for gas optimization opportunities")
  .arguments("[path]")
  .option("-o, --output <file>", "Output file for JSON report")
  .option(
    "-f, --format <format>",
    "Output format (json, sarif, gitlab, text, both)",
  )
  .option("--no-summary", "Disable printable summary")
  .option("--fix-preview", "Show fix previews for violations")
  .option(
    "-w, --watch",
    "Watch for file changes and re-run scans automatically",
  )
  .option(
    "--confidence <threshold>",
    "Minimum confidence threshold (0.0-1.0)",
    "0.7",
  )
  .option(
    "--max-files <count>",
    "Maximum number of source files to analyze",
    parsePositiveLimit,
  )
  .option(
    "--max-bytes <bytes>",
    "Maximum combined source size in bytes",
    parsePositiveLimit,
  )
  .action(async (scanPath: string = ".", options: ScanCommandOptions) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    try {
      const explicitSummary =
        scanCommand.getOptionValueSource("summary") === "cli"
          ? options.summary
          : undefined;
      const scanOptions = { ...options, summary: explicitSummary };
      await runScan(scanPath, scanOptions, controller.signal);

      if (options.watch) {
        logInfo(
          chalk.cyan(
            `\nWatch mode enabled. Listening for changes in ${scanPath}...`,
          ),
        );

        const watcher = new ScanWatcher(scanPath, {
          ignored: (p) => p.includes("node_modules") || p.includes(".git"),
        });

        watcher.watch(async (filePath) => {
          logInfo(chalk.cyan(`\n[File Changed] ${filePath}`));
          await runScan(scanPath, scanOptions);
        });

        process.on("SIGINT", () => {
          watcher.stop();
          process.exitCode = 0;
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        console.error(chalk.yellow("Repository analysis cancelled."));
        process.exitCode = 130;
        return;
      }
      const message =
        error instanceof RepositoryAnalysisError
          ? `${error.code}: ${error.message}`
          : String(error);
      console.error(chalk.red(`Error during scan: ${message}`));
      process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", abort);
    }
  });

export async function runScan(
  scanPath: string,
  options: ScanCommandOptions,
  signal?: AbortSignal,
): Promise<void> {
  const config = await loadCliConfig(options.config || getCliOptions().config);
  const scanConfig = asConfigObject(config.scan);
  const outputConfig = asConfigObject(config.output);
  const format =
    options.format || getConfigFormat(outputConfig.format) || "both";
  const showSummary =
    options.summary ?? getConfigBoolean(outputConfig.summary) ?? true;
  const confidence = Number(
    options.confidence ?? outputConfig.confidenceThreshold ?? 0.7,
  );
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Confidence threshold must be between 0 and 1.");
  }
  const include = getConfigStringArray(scanConfig.include);
  const exclude = getConfigStringArray(scanConfig.exclude);
  const maxFiles = getPositiveInteger(scanConfig.maxFiles);
  if (scanConfig.maxFiles !== undefined && maxFiles === undefined) {
    throw new Error("scan.maxFiles must be a positive safe integer.");
  }
  const maxBytes = getPositiveInteger(scanConfig.maxBytes);
  if (scanConfig.maxBytes !== undefined && maxBytes === undefined) {
    throw new Error("scan.maxBytes must be a positive safe integer.");
  }
  const progress = startProgress(`Discovering files in ${scanPath}...`);
  let files: string[];
  try {
    files = await collectScannableFiles(
      scanPath,
      {
        include,
        exclude,
        maxFiles: options.maxFiles ?? maxFiles ?? DEFAULT_MAX_FILES,
        maxBytes: options.maxBytes ?? maxBytes ?? DEFAULT_MAX_BYTES,
      },
      signal,
    );
  } catch (error) {
    finishProgress(progress, "Unable to discover scan files.", true);
    throw error;
  }
  console.log(chalk.blue(`\nScanning ${scanPath}...`));

  if (files.length === 0) {
    finishProgress(progress, "No scannable files found.");
    logInfo(chalk.yellow("No scannable files found."));
    return;
  }

  progress.text = `Scanning ${files.length} file(s)...`;
  logInfo(chalk.green(`Found ${files.length} file(s) to scan.`));

  let scanResults: ScanResult;
  try {
    scanResults = await analyzeRepositoryFiles(
      files,
      path.resolve(scanPath),
      signal,
    );
  } catch (error) {
    finishProgress(progress, "Scan failed.", true);
    throw error;
  }
  finishProgress(progress, `Scanned ${files.length} file(s).`);

  if (format === "json" || format === "both") {
    const outputPath =
      options.output ||
      path.join(os.tmpdir(), `gasguard-report-${randomUUID()}.json`);
    await generateJsonReport(scanResults, outputPath);
    logInfo(chalk.green(`JSON report saved to ${outputPath}`));
  }

  if (format === "sarif") {
    const outputPath =
      options.output ||
      path.join(os.tmpdir(), `gasguard-report-${randomUUID()}.sarif.json`);
    await generateSarifReport(scanResults, outputPath);
    logInfo(chalk.green(`SARIF report saved to ${outputPath}`));
  }

  if (format === "gitlab") {
    const outputPath =
      options.output ||
      path.join(os.tmpdir(), `gl-code-quality-report-${randomUUID()}.json`);
    await generateGitLabReport(scanResults, outputPath);
    logInfo(chalk.green(`GitLab Code Quality report saved to ${outputPath}`));
  }

  if (
    !getCliOptions().quiet &&
    showSummary &&
    (format === "text" || format === "both")
  ) {
    printSummary(scanResults, {
      fixPreview: options.fixPreview,
      confidence,
    });
  }
}

export async function collectScannableFiles(
  dirPath: string,
  limits: {
    maxFiles?: number;
    maxBytes?: number;
    include?: string[];
    exclude?: string[];
  } = {},
  signal?: AbortSignal,
): Promise<string[]> {
  const files: string[] = [];
  const extensions = [".sol", ".vy", ".rs"];
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  let totalBytes = 0;

  const checkCancelled = () => {
    if (signal?.aborted) {
      throw new RepositoryAnalysisError(
        "Repository analysis was cancelled.",
        "ANALYSIS_CANCELLED",
      );
    }
  };

  const stats = await fs.stat(dirPath);
  if (stats.isFile()) {
    checkCancelled();
    if (!extensions.includes(path.extname(dirPath))) return [];
    if (maxFiles < 1) {
      throw new RepositoryAnalysisError(
        `Repository exceeds the ${maxFiles} file limit.`,
        "FILE_LIMIT_EXCEEDED",
      );
    }
    if (stats.size > maxBytes) {
      throw new RepositoryAnalysisError(
        `Repository exceeds the ${maxBytes} byte limit.`,
        "SIZE_LIMIT_EXCEEDED",
      );
    }
    return [dirPath];
  }

  const defaultExcludes = [
    "**/node_modules/**",
    "**/.git/**",
    "**/target/**",
    "**/dist/**",
    "**/build/**",
  ];
  const patterns = limits.include?.length
    ? limits.include
    : ["**/*.sol", "**/*.vy", "**/*.rs"];
  const discovered = globIterate(patterns, {
    cwd: path.resolve(dirPath),
    absolute: true,
    nodir: true,
    ignore: [...defaultExcludes, ...(limits.exclude ?? [])],
  });
  const seen = new Set<string>();
  for await (const file of discovered) {
    checkCancelled();
    if (!extensions.includes(path.extname(file)) || seen.has(file)) continue;
    if (files.length >= maxFiles) {
      throw new RepositoryAnalysisError(
        `Repository exceeds the ${maxFiles} file limit.`,
        "FILE_LIMIT_EXCEEDED",
      );
    }
    const fileStats = await fs.stat(file);
    if (totalBytes + fileStats.size > maxBytes) {
      throw new RepositoryAnalysisError(
        `Repository exceeds the ${maxBytes} byte limit.`,
        "SIZE_LIMIT_EXCEEDED",
      );
    }
    totalBytes += fileStats.size;
    files.push(file);
    seen.add(file);
  }
  return files.sort();
}

function asConfigObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getConfigStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getConfigFormat(
  value: unknown,
): ScanCommandOptions["format"] | undefined {
  return value === "json" ||
    value === "sarif" ||
    value === "text" ||
    value === "both"
    ? value
    : undefined;
}

function getConfigBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export async function analyzeRepositoryFiles(
  files: string[],
  scanPath: string,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const analyzers: Record<string, Analyzer> = {
    ".sol": new SolidityAnalyzer(),
    ".rs": new RustAnalyzer(),
  };
  const findings: ScanResult["findings"] = [];
  const bySeverity: ScanResult["summary"]["bySeverity"] = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const byRule: Record<string, number> = {};
  let scannedFiles = 0;
  let totalGasSavings = 0;

  const checkCancelled = () => {
    if (signal?.aborted) {
      throw new RepositoryAnalysisError(
        "Repository analysis was cancelled.",
        "ANALYSIS_CANCELLED",
      );
    }
  };

  try {
    for (const filePath of files) {
      checkCancelled();
      const analyzer = analyzers[path.extname(filePath)];
      if (!analyzer) {
        console.warn(`Skipping unsupported source file: ${filePath}`);
        continue;
      }

      try {
        const code = await fs.readFile(filePath, "utf8");
        checkCancelled();
        const result = await analyzer.analyze(code, filePath);
        checkCancelled();
        scannedFiles += result.filesAnalyzed;
        for (const finding of result.findings) {
          findings.push(toCliFinding(finding, analyzer));
          const severity =
            finding.severity.toLowerCase() as keyof typeof bySeverity;
          if (severity in bySeverity) bySeverity[severity]++;
          byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
          totalGasSavings += finding.estimatedGasSavings ?? 0;
        }
        for (const issue of result.errors ?? []) {
          console.warn(`Analyzer warning for ${issue.file}: ${issue.message}`);
        }
      } catch (error) {
        if (signal?.aborted) checkCancelled();
        console.warn(
          `Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await Promise.all(
      Object.values(analyzers).map(async (analyzer) => {
        try {
          await analyzer.dispose();
        } catch (error) {
          console.warn(
            `Failed to dispose ${analyzer.getName()}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }

  const results: ScanResult = {
    timestamp: new Date().toISOString(),
    scanPath,
    totalFiles: files.length,
    scannedFiles,
    findings,
    summary: {
      totalViolations: findings.length,
      bySeverity,
      byRule,
      totalGasSavings,
    },
  };

  return results;
}

function toCliFinding(
  finding: EngineFinding,
  analyzer: Analyzer,
): ScanResult["findings"][number] {
  return {
    file: finding.location.file,
    line: finding.location.startLine,
    ruleId: finding.ruleId,
    ruleName: analyzer.getRule(finding.ruleId)?.name ?? finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    suggestion: finding.suggestedFix?.description,
    gasSavings: finding.estimatedGasSavings,
  };
}
