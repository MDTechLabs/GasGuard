# Soroban Analysis Result Diffing

This module provides functionality to compare Soroban contract analysis results between scans, highlighting added and removed issues with detailed breakdowns.

## Overview

The Soroban diffing module helps developers track changes across versions by:
- Comparing findings between two scan results
- Highlighting added and removed issues
- Providing detailed severity and category breakdowns
- Generating reports in multiple formats (text, markdown, JSON)

## Components

### SorobanResultDiffer

The core diffing engine that compares two sets of Soroban analysis results.

**Features:**
- Identifies new, fixed, and persistent issues
- Calculates severity breakdowns (error, warning, info)
- Calculates category breakdowns (security, gas, etc.)
- Supports sorting by severity, confidence, or contract
- Supports grouping by contract, rule, severity, or category

**Usage:**
```typescript
import { SorobanResultDiffer } from './soroban-result-differ';

const differ = new SorobanResultDiffer();
const diff = differ.diff(previousResults, currentResults);
```

### SorobanDiffReporter

Generates human-readable reports from diff results.

**Features:**
- Text-based summary with emoji indicators
- Markdown report with tables and badges
- JSON report for programmatic consumption
- Configurable grouping and sorting options

**Usage:**
```typescript
import { SorobanDiffReporter } from './soroban-diff-reporter';

const reporter = new SorobanDiffReporter();
const summary = reporter.generateSummary(diff);
const markdown = reporter.generateMarkdownReport(diff);
const json = reporter.generateJsonReport(diff);
```

## Data Structures

### SorobanAnalysisResult

```typescript
interface SorobanAnalysisResult {
  ruleId: string;           // Unique rule identifier
  contractName: string;     // Name of the contract
  filePath: string;         // Path to the file
  line: number;             // Line number
  function?: string;        // Function name (optional)
  message: string;          // Issue description
  severity: 'error' | 'warning' | 'info';
  confidence: number;       // 0.0 to 1.0
  category: string;         // Issue category (e.g., 'security', 'gas')
}
```

### SorobanScanDiff

```typescript
interface SorobanScanDiff {
  newIssues: SorobanAnalysisResult[];
  fixedIssues: SorobanAnalysisResult[];
  persistentIssues: SorobanAnalysisResult[];
  summary: {
    added: number;
    removed: number;
    unchanged: number;
    delta: number;
    bySeverity: {
      error: { added: number; removed: number };
      warning: { added: number; removed: number };
      info: { added: number; removed: number };
    };
    byCategory: Record<string, { added: number; removed: number }>;
  };
}
```

## Example

```typescript
import { SorobanResultDiffer, SorobanDiffReporter } from './index';

const previous = [
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
  }
];

const current = [
  {
    ruleId: 'SOR-002',
    contractName: 'TokenContract',
    filePath: 'contracts/token.wasm',
    line: 20,
    function: 'approve',
    message: 'Missing access control',
    severity: 'warning',
    confidence: 0.8,
    category: 'security'
  }
];

const differ = new SorobanResultDiffer();
const reporter = new SorobanDiffReporter();

const diff = differ.diff(previous, current);
console.log(reporter.generateSummary(diff));
```

## Running the Demo

To run the demonstration:

```bash
cd src/diffing/stellar
npm run build
node dist/soroban-result-differ.spec.js
```

Or directly with ts-node:

```bash
npx ts-node src/diffing/stellar/soroban-result-differ.spec.ts
```

## Acceptance Criteria

- ✅ Result diffing implemented
- ✅ Changes clearly reported with severity and category breakdowns
- ✅ Support for multiple output formats (text, markdown, JSON)
- ✅ Configurable grouping and sorting options
- ✅ Demo script included
