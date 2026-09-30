import { Command } from "commander";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import {
  generateJsonReport,
  type ScanResult,
} from "../reporting/json-reporter";
import { generateSarifReport } from "../reporting/sarif-reporter";
import { printSummary } from "../reporting/summary-printer";
import { ScanWatcher } from "../../../../src/analysis/watch/watcher";
import { glob } from "glob";
import { loadCliConfig } from "../config/config-loader";
import {
  finishProgress,
  getCliOptions,
  logInfo,
  startProgress,
} from "../output";

export interface ScanCommandOptions {
  output?: string;
  format?: "json" | "sarif" | "text" | "both";
  summary?: boolean;
  fixPreview?: boolean;
  watch?: boolean;
  confidence?: string;
  config?: string;
}

export const scanCommand = new Command("scan")
  .description("Scan smart contracts for gas optimization opportunities")
  .arguments("[path]")
  .option("-o, --output <file>", "Output file for JSON report")
  .option("-f, --format <format>", "Output format (json, sarif, text, both)")
  .option("--no-summary", "Disable printable summary")
  .option("--fix-preview", "Show fix previews for violations")
  .option(
    "-w, --watch",
    "Watch for file changes and re-run scans automatically",
  )
  .option("--confidence <threshold>", "Minimum confidence threshold (0.0-1.0)")
  .action(async (scanPath: string = ".", options: ScanCommandOptions) => {
    try {
      const explicitSummary =
        scanCommand.getOptionValueSource("summary") === "cli"
          ? options.summary
          : undefined;
      const scanOptions = { ...options, summary: explicitSummary };
      await runScan(scanPath, scanOptions);

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
          process.exit(0);
        });
      }
    } catch (error) {
      console.error(chalk.red(`Error during scan: ${error}`));
      process.exit(1);
    }
  });

export async function runScan(
  scanPath: string,
  options: ScanCommandOptions,
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
  const progress = startProgress(`Discovering files in ${scanPath}...`);
  let files: string[];
  try {
    files = await collectScannableFiles(scanPath, include, exclude);
  } catch (error) {
    finishProgress(progress, "Unable to discover scan files.", true);
    throw error;
  }
  if (maxFiles !== undefined) {
    files = files.slice(0, maxFiles);
  }

  if (files.length === 0) {
    finishProgress(progress, "No scannable files found.");
    logInfo(chalk.yellow("No scannable files found."));
    return;
  }

  progress.text = `Scanning ${files.length} file(s)...`;
  logInfo(chalk.green(`Found ${files.length} file(s) to scan.`));

  let scanResults: ScanResult;
  try {
    scanResults = await simulateScan(files);
  } catch (error) {
    finishProgress(progress, "Scan failed.", true);
    throw error;
  }
  finishProgress(progress, `Scanned ${files.length} file(s).`);

  if (format === "json" || format === "both") {
    const outputPath =
      options.output || path.join(process.cwd(), "gasguard-report.json");
    await generateJsonReport(scanResults, outputPath);
    logInfo(chalk.green(`JSON report saved to ${outputPath}`));
  }

  if (format === "sarif") {
    const outputPath =
      options.output || path.join(process.cwd(), "gasguard-report.sarif.json");
    await generateSarifReport(scanResults, outputPath);
    logInfo(chalk.green(`SARIF report saved to ${outputPath}`));
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

async function collectScannableFiles(
  dirPath: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<string[]> {
  const extensions = [".sol", ".vy", ".rs"];

  const stats = await fs.stat(dirPath);
  if (stats.isFile()) {
    return extensions.includes(path.extname(dirPath)) ? [dirPath] : [];
  }

  const defaultExcludes = [
    "**/node_modules/**",
    "**/.git/**",
    "**/target/**",
    "**/dist/**",
    "**/build/**",
  ];
  const patterns = includePatterns.length
    ? includePatterns
    : ["**/*.sol", "**/*.vy", "**/*.rs"];
  const files = await glob(patterns, {
    cwd: path.resolve(dirPath),
    absolute: true,
    nodir: true,
    ignore: [...defaultExcludes, ...excludePatterns],
  });
  return files.filter((file) => extensions.includes(path.extname(file))).sort();
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

async function simulateScan(files: string[]): Promise<ScanResult> {
  const results: ScanResult = {
    timestamp: new Date().toISOString(),
    scanPath: files[0] || ".",
    totalFiles: files.length,
    scannedFiles: files.length,
    findings: [],
    summary: {
      totalViolations: 0,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      byRule: {},
      totalGasSavings: 0,
    },
  };

  if (files.length > 0) {
    results.findings.push({
      file: files[0],
      line: 10,
      ruleId: "SOL-001",
      ruleName: "string-to-bytes32",
      severity: "high",
      message: "Use bytes32 instead of string for fixed-length data",
      suggestion: "Replace string with bytes32 to save gas",
      gasSavings: 5000,
      confidence: 0.9,
    });

    results.summary.totalViolations = 1;
    results.summary.bySeverity.high = 1;
    results.summary.byRule["SOL-001"] = 1;
    results.summary.totalGasSavings = 5000;
  }

  return results;
}
