/**
 * Result Differ Test
 * 
 * Demonstrates tracking improvements and regressions between runs.
 */

import { ResultDiffer } from './result-differ';
import { DiffReporter } from './diff-reporter';

async function runDiffDemo() {
  const differ = new ResultDiffer();
  const reporter = new DiffReporter();

  const previousRun = [
    { ruleId: 'GAS-001', filePath: 'contracts/Auth.sol', line: 10, message: 'Issue 1', confidence: 0.9 },
    { ruleId: 'GAS-002', filePath: 'contracts/Bank.sol', line: 25, message: 'Issue 2', confidence: 0.8 },
    { ruleId: 'SEC-003', filePath: 'contracts/Vault.sol', line: 50, message: 'Issue 3', confidence: 0.7 }
  ];

  const currentRun = [
    // Issue 1 is persistent
    { ruleId: 'GAS-001', filePath: 'contracts/Auth.sol', line: 10, message: 'Issue 1', confidence: 0.9 },
    // Issue 2 is fixed (not here)
    // Issue 3 is persistent
    { ruleId: 'SEC-003', filePath: 'contracts/Vault.sol', line: 50, message: 'Issue 3', confidence: 0.7 },
    // Issue 4 is NEW
    { ruleId: 'GAS-004', filePath: 'contracts/New.sol', line: 5, message: 'New Issue', confidence: 0.85 }
  ];

  console.log('--- Running Diff Analysis ---');
  const diff = differ.diff(previousRun, currentRun);
  
  const summary = reporter.generateSummary(diff);
  console.log(summary);
}

if (require.main === module) {
  runDiffDemo().catch(console.error);
}

export { runDiffDemo };
