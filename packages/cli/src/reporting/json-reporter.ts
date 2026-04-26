import fs from 'fs-extra';
import path from 'path';

export interface ScanResult {
  timestamp: string;
  scanPath: string;
  totalFiles: number;
  scannedFiles: number;
  findings: Finding[];
  summary: Summary;
}

export interface Finding {
  file: string;
  line: number;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  suggestion?: string;
  gasSavings?: number;
  confidence?: number;
}

export interface Summary {
  totalViolations: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  byRule: Record<string, number>;
  totalGasSavings: number;
}

export async function generateJsonReport(results: ScanResult, outputPath: string): Promise<void> {
  const report = {
    metadata: {
      version: '1.0.0',
      tool: 'GasGuard CLI',
      timestamp: results.timestamp,
      scanPath: results.scanPath,
    },
    summary: {
      totalFiles: results.totalFiles,
      scannedFiles: results.scannedFiles,
      totalViolations: results.summary.totalViolations,
      totalGasSavings: results.summary.totalGasSavings,
      bySeverity: results.summary.bySeverity,
      byRule: results.summary.byRule,
    },
    findings: results.findings.map(finding => ({
      ...finding,
      category: categorizeFinding(finding),
    })),
  };

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.ensureDir(outputDir);

  // Write JSON report
  await fs.writeJson(outputPath, report, { spaces: 2 });
}

function categorizeFinding(finding: Finding): string {
  if (finding.ruleId.startsWith('SOL-')) return 'solidity';
  if (finding.ruleId.startsWith('VY-')) return 'vyper';
  if (finding.ruleId.startsWith('RS-')) return 'rust';
  if (finding.ruleId.startsWith('SOR-')) return 'soroban';
  return 'general';
}

export async function generateCsvReport(results: ScanResult, outputPath: string): Promise<void> {
  const headers = ['File', 'Line', 'Rule ID', 'Rule Name', 'Severity', 'Message', 'Gas Savings', 'Confidence'];
  const rows = results.findings.map(f => [
    f.file,
    f.line.toString(),
    f.ruleId,
    f.ruleName,
    f.severity,
    f.message,
    f.gasSavings?.toString() || 'N/A',
    f.confidence?.toFixed(2) || 'N/A',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');

  const outputDir = path.dirname(outputPath);
  await fs.ensureDir(outputDir);
  await fs.writeFile(outputPath, csvContent);
}
