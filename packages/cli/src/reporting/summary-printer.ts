import chalk from 'chalk';
import { ScanResult } from './json-reporter';

export interface SummaryOptions {
  fixPreview?: boolean;
  confidence?: number;
}

export function printSummary(results: ScanResult, options: SummaryOptions = {}): void {
  console.log('\n' + chalk.bold.blue('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.blue('                    GasGuard Scan Report'));
  console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════\n'));

  // Scan metadata
  console.log(chalk.gray(`Scan Path: ${results.scanPath}`));
  console.log(chalk.gray(`Timestamp: ${results.timestamp}`));
  console.log(chalk.gray(`Files Scanned: ${results.scannedFiles}/${results.totalFiles}\n`));

  // Summary statistics
  console.log(chalk.bold('Summary Statistics:'));
  console.log(`  Total Violations: ${chalk.yellow(results.summary.totalViolations.toString())}`);
  console.log(`  Total Gas Savings: ${chalk.green(formatGasSavings(results.summary.totalGasSavings))}\n`);

  // By severity
  console.log(chalk.bold('Violations by Severity:'));
  printSeverity('Critical', results.summary.bySeverity.critical, 'red');
  printSeverity('High', results.summary.bySeverity.high, 'yellow');
  printSeverity('Medium', results.summary.bySeverity.medium, 'yellow');
  printSeverity('Low', results.summary.bySeverity.low, 'blue');
  printSeverity('Info', results.summary.bySeverity.info, 'gray');
  console.log();

  // By rule
  if (Object.keys(results.summary.byRule).length > 0) {
    console.log(chalk.bold('Violations by Rule:'));
    const sortedRules = Object.entries(results.summary.byRule)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10); // Show top 10
    
    for (const [rule, count] of sortedRules) {
      console.log(`  ${chalk.cyan(rule)}: ${count}`);
    }
    console.log();
  }

  // Findings details
  if (results.findings.length > 0) {
    console.log(chalk.bold('Findings Details:'));
    console.log(chalk.gray('─'.repeat(60)));
    
    for (const finding of results.findings.slice(0, 20)) { // Show first 20
      printFinding(finding, options);
    }
    
    if (results.findings.length > 20) {
      console.log(chalk.gray(`\n... and ${results.findings.length - 20} more findings`));
    }
    console.log();
  }

  console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════\n'));
}

function printSeverity(label: string, count: number, color: string): void {
  const coloredCount = count > 0 ? chalk[color](count.toString()) : chalk.gray('0');
  console.log(`  ${label.padEnd(10)}: ${coloredCount}`);
}

function printFinding(finding: any, options: SummaryOptions): void {
  const severityColor = getSeverityColor(finding.severity);
  const confidence = finding.confidence ? ` (confidence: ${finding.confidence.toFixed(2)})` : '';
  
  console.log(`\n${chalk.bold(severityColor(`[${finding.severity.toUpperCase()}]`))} ${finding.ruleId} - ${finding.ruleName}`);
  console.log(chalk.gray(`  File: ${finding.file}:${finding.line}`));
  console.log(chalk.gray(`  Message: ${finding.message}`));
  
  if (finding.gasSavings) {
    console.log(chalk.green(`  Gas Savings: ${formatGasSavings(finding.gasSavings)}`));
  }
  
  if (confidence) {
    console.log(chalk.gray(confidence));
  }
  
  if (options.fixPreview && finding.suggestion) {
    console.log(chalk.cyan(`  Suggestion: ${finding.suggestion}`));
  }
}

function getSeverityColor(severity: string): (text: string) => string {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'error':
      return chalk.red;
    case 'high':
      return chalk.yellow;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.blue;
    case 'info':
    default:
      return chalk.gray;
  }
}

function formatGasSavings(gas: number): string {
  if (gas >= 1000000) {
    return `${(gas / 1000000).toFixed(2)}M gas`;
  } else if (gas >= 1000) {
    return `${(gas / 1000).toFixed(2)}K gas`;
  }
  return `${gas} gas`;
}

export function printCompactSummary(results: ScanResult): void {
  const critical = results.summary.bySeverity.critical;
  const high = results.summary.bySeverity.high;
  const medium = results.summary.bySeverity.medium;
  const low = results.summary.bySeverity.low;
  
  let status = chalk.green('✓ PASS');
  if (critical > 0) {
    status = chalk.red('✗ FAIL');
  } else if (high > 0) {
    status = chalk.yellow('⚠ WARN');
  }
  
  console.log(`${status} ${results.summary.totalViolations} issues found (${critical} critical, ${high} high, ${medium} medium, ${low} low) - ${formatGasSavings(results.summary.totalGasSavings)} potential savings`);
}
