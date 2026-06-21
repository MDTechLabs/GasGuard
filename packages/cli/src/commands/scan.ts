import { Command } from "commander";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { generateJsonReport } from "../../reporting/json-reporter";
import { generateSarifReport } from "../../reporting/sarif-reporter";
import { printSummary } from "../../reporting/summary-printer";
import { ScanWatcher } from "../../../../src/analysis/watch/watcher";
import { SolidityAnalyzer } from "../../../../libs/engine/analyzers/solidity-analyzer";
import { RustAnalyzer } from "../../../../libs/engine/analyzers/rust-analyzer";

export const scanCommand = new Command("scan")
  .description("Scan smart contracts for gas optimization opportunities")
  .argument("[path]", "Path to scan (default: current directory)", ".")
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
  .action(async (scanPath: string, options) => {
    try {
      const runScan = async () => {
        console.log(chalk.blue(`\n🔍 Scanning ${scanPath}...`));

        // Collect scannable files
        const files = await collectScannableFiles(scanPath);

        if (files.length === 0) {
          console.log(chalk.yellow("No scannable files found."));
          return;
        }

        console.log(chalk.green(`Found ${files.length} file(s) to scan.`));

        const scanResults = await runAnalysis(files);

        // Generate reports
        if (options.format === "json" || options.format === "both") {
          const outputPath =
            options.output || path.join(process.cwd(), "gasguard-report.json");
          await generateJsonReport(scanResults, outputPath);
          console.log(chalk.green(`✓ JSON report saved to ${outputPath}`));
        }

        if (options.format === "sarif") {
          const outputPath =
            options.output ||
            path.join(process.cwd(), "gasguard-report.sarif.json");
          await generateSarifReport(scanResults, outputPath);
          console.log(chalk.green(`✓ SARIF report saved to ${outputPath}`));
        }

        if (
          options.summary !== false &&
          (options.format === "text" || options.format === "both")
        ) {
          printSummary(scanResults, options);
        }
      };

      // Perform initial scan
      await runScan();

      // Setup Watch Mode if requested
      if (options.watch) {
        console.log(
          chalk.cyan(
            `\n👀 Watch mode enabled. Listening for changes in ${scanPath}...`,
          ),
        );
        const watcher = new ScanWatcher(scanPath, {
          ignored: (p) => p.includes("node_modules") || p.includes(".git"),
        });

        watcher.watch(async (filePath) => {
          console.log(chalk.cyan(`\n[File Changed] ${filePath}`));
          await runScan();
        });

        // Keep the process alive
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

async function collectScannableFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = [".sol", ".vy", ".rs"];

  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and .git
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

async function runAnalysis(files: string[]): Promise<any> {
  const findings: any[] = [];
  const solAnalyzer = new SolidityAnalyzer();
  const rustAnalyzer = new RustAnalyzer();

  for (const filePath of files) {
    try {
      const code = await fs.readFile(filePath, "utf8");
      const ext = path.extname(filePath);
      let result;

      if (ext === ".sol") {
        result = await solAnalyzer.analyze(code, filePath);
      } else if (ext === ".rs") {
        result = await rustAnalyzer.analyze(code, filePath);
      } else {
        continue;
      }

      for (const f of result.findings) {
        findings.push({
          file: f.location.file,
          line: f.location.startLine,
          ruleId: f.ruleId,
          ruleName: "",
          severity: f.severity,
          message: f.message,
          suggestion: f.suggestedFix?.description,
          gasSavings: f.estimatedGasSavings,
          confidence: f.metadata?.confidence ?? 0.8,
        });
      }
    } catch (error) {
      console.error(chalk.yellow(`  ⚠ Error scanning ${filePath}: ${error}`));
    }
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byRule: Record<string, number> = {};
  let totalGasSavings = 0;

  for (const f of findings) {
    if (bySeverity[f.severity] !== undefined) bySeverity[f.severity]++;
    byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1;
    totalGasSavings += f.gasSavings || 0;
  }

  return {
    timestamp: new Date().toISOString(),
    scanPath: files[0] || ".",
    totalFiles: files.length,
    scannedFiles: files.length,
    findings,
    summary: {
      totalViolations: findings.length,
      bySeverity,
      byRule,
      totalGasSavings,
    },
  };
}
