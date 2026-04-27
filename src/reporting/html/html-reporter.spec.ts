/**
 * HTML Reporter Test
 * 
 * Demonstrates generating a human-readable report.
 */

import { HtmlReporter } from './html-reporter';
import * as path from 'path';

async function runDemo() {
  const reporter = new HtmlReporter();
  
  const sampleIssues = [
    {
      ruleId: 'GAS-001',
      filePath: 'contracts/Vulnerable.sol',
      line: 42,
      message: 'Unchecked loop variable increment leading to potential gas exhaustion.',
      confidence: 0.95
    },
    {
      ruleId: 'GAS-002',
      filePath: 'contracts/Vulnerable.sol',
      line: 128,
      message: 'Expensive state variable access in loop. Consider caching in memory.',
      confidence: 0.82
    },
    {
      ruleId: 'SEC-005',
      filePath: 'contracts/Auth.sol',
      line: 12,
      message: 'Implicit visibility for state variable. Should be explicitly public or private.',
      confidence: 0.45
    }
  ];

  const reportData = reporter.createReportData(
    'StellarAid-Web',
    'v1.2.0-beta',
    sampleIssues,
    156, // total files
    2450 // duration ms
  );

  const outputPath = path.join(process.cwd(), 'reports', 'analysis-report.html');
  console.log(`Generating report at: ${outputPath}`);
  
  await reporter.saveReport(reportData, outputPath);
  console.log('Report generated successfully!');
}

if (require.main === module) {
  runDemo().catch(console.error);
}

export { runDemo };
