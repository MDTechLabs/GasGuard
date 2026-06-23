import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import { generateJsonReport, type ScanResult } from "../reporting/json-reporter";
import { generateSarifReport } from "../reporting/sarif-reporter";
import { printSummary } from "../reporting/summary-printer";
import { ScanWatcher } from "../../../../src/analysis/watch/watcher";

const fs: any = require("fs-extra");

export interface ScanCommandOptions {
  output?: string;
  format: "json" | "sarif" | "text" | "both";
  summary?: boolean;
  fixPreview?: boolean;
  watch?: boolean;
  confidence: string;
}

export const scanCommand = new Command("scan")
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
  .action(async (scanPath: string = ".", options: ScanCommandOptions) => {
    try {
      await runScan(scanPath, options);

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
  console.log(chalk.blue(`\nScanning ${scanPath}...`));

  const files = await collectScannableFiles(scanPath);

  if (files.length === 0) {
    console.log(chalk.yellow("No scannable files found."));
    return;
  }

  console.log(chalk.green(`Found ${files.length} file(s) to scan.`));

  const scanResults = await simulateScan(files);

  if (options.format === "json" || options.format === "both") {
    const outputPath =
      options.output || path.join(process.cwd(), "gasguard-report.json");
    await generateJsonReport(scanResults, outputPath);
    console.log(chalk.green(`JSON report saved to ${outputPath}`));
  }

  if (options.format === "sarif") {
    const outputPath =
      options.output || path.join(process.cwd(), "gasguard-report.sarif.json");
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

async function collectScannableFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = [".sol", ".vy", ".rs"];

  const stats = await fs.stat(dirPath);
  if (stats.isFile()) {
    return extensions.includes(path.extname(dirPath)) ? [dirPath] : [];
  }

  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
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
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return files;
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
