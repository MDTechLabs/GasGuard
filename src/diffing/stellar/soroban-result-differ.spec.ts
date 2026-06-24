/**
 * Soroban Result Differ Test
 * 
 * Demonstrates tracking improvements and regressions between Soroban contract scans.
 */

import { SorobanResultDiffer } from './soroban-result-differ';
import { SorobanDiffReporter } from './soroban-diff-reporter';
import { SorobanAnalysisResult } from './types';

async function runSorobanDiffDemo() {
  const differ = new SorobanResultDiffer();
  const reporter = new SorobanDiffReporter();

  const previousRun: SorobanAnalysisResult[] = [
    {
      ruleId: 'SOR-001',
      contractName: 'TokenContract',
      filePath: 'contracts/token.wasm',
      line: 10,
      function: 'transfer',
      message: 'Potential integer overflow',
      severity: 'error',
      confidence: 0.9,
      category: 'security'
    },
    {
      ruleId: 'SOR-002',
      contractName: 'TokenContract',
      filePath: 'contracts/token.wasm',
      line: 25,
      function: 'approve',
      message: 'Missing access control',
      severity: 'warning',
      confidence: 0.8,
      category: 'security'
    },
    {
      ruleId: 'GAS-001',
      contractName: 'TokenContract',
      filePath: 'contracts/token.wasm',
      line: 50,
      message: 'Inefficient loop',
      severity: 'info',
      confidence: 0.7,
      category: 'gas'
    }
  ];

  const currentRun: SorobanAnalysisResult[] = [
    // Issue 1 is persistent
    {
      ruleId: 'SOR-001',
      contractName: 'TokenContract',
      filePath: 'contracts/token.wasm',
      line: 10,
      function: 'transfer',
      message: 'Potential integer overflow',
      severity: 'error',
      confidence: 0.9,
      category: 'security'
    },
    // Issue 2 is fixed (not here)
    // Issue 3 is persistent
    {
      ruleId: 'GAS-001',
      contractName: 'TokenContract',
      filePath: 'contracts/token.wasm',
      line: 50,
      message: 'Inefficient loop',
      severity: 'info',
      confidence: 0.7,
      category: 'gas'
    },
    // New issue
    {
      ruleId: 'SOR-003',
      contractName: 'TokenContract',
      filePath: 'contracts/token.wasm',
      line: 75,
      function: 'mint',
      message: 'Unchecked return value',
      severity: 'error',
      confidence: 0.85,
      category: 'security'
    }
  ];

  console.log('--- Running Soroban Diff Analysis ---');
  const diff = differ.diff(previousRun, currentRun);
  
  console.log('\n--- Text Summary ---');
  const summary = reporter.generateSummary(diff);
  console.log(summary);

  console.log('\n--- Markdown Report ---');
  const markdownReport = reporter.generateMarkdownReport(diff);
  console.log(markdownReport);

  console.log('\n--- JSON Report ---');
  const jsonReport = reporter.generateJsonReport(diff);
  console.log(jsonReport);
}

if (require.main === module) {
  runSorobanDiffDemo().catch(console.error);
}

export { runSorobanDiffDemo };
