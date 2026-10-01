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
import { printSummary } from "../reporting/summary-printer";
import { SolidityAnalyzer } from "../../../../libs/engine/analyzers/solidity-analyzer";
import { RustAnalyzer } from "../../../../libs/engine/analyzers/rust-analyzer";
import type {
  Analyzer,
  Finding as EngineFinding,
} from "../../../../libs/engine/core/analyzer-interface";
import { ScanWatcher } from "../../../../src/analysis/watch/watcher";

export interface ScanCommandOptions {
  output?: string;
  format: "json" | "sarif" | "text" | "both";
  summary?: boolean;
  fixPreview?: boolean;
  watch?: boolean;
  confidence: string;
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
    "Output format (json, sarif, text, both)",
    "both",
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
    DEFAULT_MAX_FILES,
  )
  .option(
    "--max-bytes <bytes>",
    "Maximum combined source size in bytes",
    parsePositiveLimit,
    DEFAULT_MAX_BYTES,
  )
  .action(async (scanPath: string = ".", options: ScanCommandOptions) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    try {
      await runScan(scanPath, options, controller.signal);

      if (options.watch) {
        console.log(
          chalk.cyan(
            `\nWatch mode enabled. Listening for changes in ${scanPath}...`,
          ),
        );

        const watcher = new ScanWatcher(scanPath, {
          ignored: (p) => p.includes("node_modules") || p.includes(".git"),
        });

        watcher.watch(async (filePath) => {
          console.log(chalk.cyan(`\n[File Changed] ${filePath}`));
          await runScan(scanPath, options);
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
      console.error(chalk.red(`Error during scan: ${error}`));
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
  console.log(chalk.blue(`\nScanning ${scanPath}...`));

  const files = await collectScannableFiles(
    scanPath,
    {
      maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    },
    signal,
  );

  if (files.length === 0) {
    console.log(chalk.yellow("No scannable files found."));
    return;
  }

  console.log(chalk.green(`Found ${files.length} file(s) to scan.`));

  const scanResults = await analyzeRepositoryFiles(
    files,
    path.resolve(scanPath),
    signal,
  );

  if (options.format === "json" || options.format === "both") {
    const outputPath =
      options.output ||
      path.join(os.tmpdir(), `gasguard-report-${randomUUID()}.json`);
    await generateJsonReport(scanResults, outputPath);
    console.log(chalk.green(`JSON report saved to ${outputPath}`));
  }

  if (options.format === "sarif") {
    const outputPath =
      options.output ||
      path.join(os.tmpdir(), `gasguard-report-${randomUUID()}.sarif.json`);
    await generateSarifReport(scanResults, outputPath);
    console.log(chalk.green(`SARIF report saved to ${outputPath}`));
  }

  if (
    options.summary !== false &&
    (options.format === "text" || options.format === "both")
  ) {
    printSummary(scanResults, {
      fixPreview: options.fixPreview,
      confidence: Number(options.confidence),
    });
  }
}

export async function collectScannableFiles(
  dirPath: string,
  limits: { maxFiles?: number; maxBytes?: number } = {},
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

  async function walk(currentPath: string) {
    checkCancelled();
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      checkCancelled();
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (
          !["node_modules", ".git", "target", "dist", "build"].includes(
            entry.name,
          )
        ) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          const fileStats = await fs.stat(fullPath);
          if (files.length >= maxFiles) {
            throw new RepositoryAnalysisError(
              `Repository exceeds the ${maxFiles} file limit.`,
              "FILE_LIMIT_EXCEEDED",
            );
          }
          if (totalBytes + fileStats.size > maxBytes) {
            throw new RepositoryAnalysisError(
              `Repository exceeds the ${maxBytes} byte limit.`,
              "SIZE_LIMIT_EXCEEDED",
            );
          }
          totalBytes += fileStats.size;
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return files;
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
