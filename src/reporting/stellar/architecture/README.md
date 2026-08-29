# Soroban Contract Architecture Reporter

Generate comprehensive architectural summaries for Soroban smart contracts to help auditors and developers quickly understand project structure, security boundaries, and optimization opportunities.

## Features

✅ **Module & Type Analysis** - Automatically extracts contract types, enums, traits, and state structure  
✅ **Function Inventory** - Categorizes functions by purpose (admin, transfer, query, emergency, etc.)  
✅ **Storage Pattern Detection** - Identifies redundant reads, loop storage access, and caching opportunities  
✅ **Security Boundary Analysis** - Detects access control mechanisms, pause circuits, and vulnerability indicators  
✅ **Resource Profiling** - Estimates CPU, memory, and ledger resource consumption  
✅ **Optimization Recommendations** - Provides actionable suggestions with estimated savings  
✅ **Multi-Format Export** - Supports JSON, Markdown, and HTML output formats

## Installation

```typescript
import {
  SorobanArchitectureAnalyzer,
  SorobanArchitectureReporter,
  ArchitectureReportOptions,
} from "./reporting/stellar/architecture";
```

## Usage

### Basic Usage

```typescript
import * as fs from "fs";
import {
  SorobanArchitectureAnalyzer,
  SorobanArchitectureReporter,
} from "./reporting/stellar/architecture";

// Read contract source
const contractSource = fs.readFileSync("path/to/contract.rs", "utf8");

// Create analyzer
const analyzer = new SorobanArchitectureAnalyzer(contractSource, "contract.rs");

// Generate architecture summary
const summary = analyzer.analyze();

// Create reporter and generate markdown report
const reporter = new SorobanArchitectureReporter();
const markdownReport = reporter.generate(summary, { format: "markdown" });

console.log(markdownReport);
```

### With Risk Score and Findings

```typescript
import { StellarRiskScoringEngine } from '../../../scoring/stellar/risk-scoring-engine';
import { Finding } from '@engine/core';

// Assume you have findings from your analysis
const findings: Finding[] = [...];

// Calculate risk score
const scoringEngine = new StellarRiskScoringEngine();
const riskScore = scoringEngine.calculateRiskScore(findings);

// Generate summary with risk assessment
const summary = analyzer.analyze(findings, riskScore);

// Generate report with findings included
const report = reporter.generate(summary, {
  format: 'markdown',
  includeFindings: true,
  includeRiskScore: true,
  projectName: 'MyDApp',
  contractVersion: '1.0.0',
});
```

### With Execution Metrics

```typescript
import { StellarTransactionSimulator } from '../../../simulation/stellar/stellar-simulator';

// Simulate contract execution
const simulator = new StellarTransactionSimulator('https://soroban-testnet.stellar.org');
const simulationResult = await simulator.simulateContractCall({
  contractId: 'C...',
  method: 'transfer',
  params: [...],
  rpcUrl: 'https://soroban-testnet.stellar.org',
});

// Include metrics in analysis
const summary = analyzer.analyze(
  findings,
  riskScore,
  simulationResult.metrics
);
```

### Export to File

```typescript
// Save as Markdown
await reporter.saveReport(summary, {
  format: "markdown",
  outputPath: "./reports/architecture-report.md",
  projectName: "MyDApp",
  contractVersion: "1.0.0",
});

// Save as JSON
await reporter.saveReport(summary, {
  format: "json",
  outputPath: "./reports/architecture-report.json",
});

// Save as HTML
await reporter.saveReport(summary, {
  format: "html",
  outputPath: "./reports/architecture-report.html",
  includeRiskScore: true,
  includeFindings: true,
});
```

## Report Sections

### 1. Executive Summary

- Contract name, type, and complexity
- Lines of code and function count
- Overall efficiency rating
- Risk level (if included)

### 2. Contract Information

- File path and basic metadata
- Testing and documentation status

### 3. Module Structure

- Contract types with field analysis
- Enums and traits
- State complexity assessment
- Version tracking detection
- Pause state and access control detection

### 4. Function Inventory

- Complete function categorization
- Security level classification
- Complexity metrics
- Error handling and auth check detection
- Expiry validation detection

### 5. Storage Patterns

- Read/write operation counts
- Detected anti-patterns (redundant reads, loop storage)
- Optimization opportunities with estimated savings

### 6. Security Boundaries

- Access control mechanism identification
- Admin function listing
- Pause circuit and emergency mechanism detection
- Vulnerability indicators:
  - Missing expiry checks
  - Front-running vulnerabilities
  - Weak randomness
  - Unchecked math operations

### 7. Resource Profile

- CPU/Memory/Ledger utilization
- Complex function identification
- Performance bottlenecks
- Overall efficiency rating

### 8. Dependencies

- External contract references
- Internal dependency graph
- Circular dependency detection
- Complexity scoring

### 9. Risk Assessment (optional)

- Overall risk score
- Security, optimization, and gas scores
- Actionable recommendations

### 10. Detailed Findings (optional)

- Critical, high, and medium priority issues
- Rule violations with locations

## Integration with CI/CD

```typescript
// Example: Generate architecture report in CI pipeline
import {
  SorobanArchitectureAnalyzer,
  SorobanArchitectureReporter,
} from "./reporting/stellar/architecture";
import * as glob from "glob";

async function generateArchitectureReports() {
  const contracts = glob.sync("contracts/**/*.rs");

  for (const contractPath of contracts) {
    const source = fs.readFileSync(contractPath, "utf8");
    const analyzer = new SorobanArchitectureAnalyzer(source, contractPath);
    const summary = analyzer.analyze();

    const reporter = new SorobanArchitectureReporter();
    await reporter.saveReport(summary, {
      format: "markdown",
      outputPath: `./reports/${path.basename(contractPath, ".rs")}-architecture.md`,
      projectName: "MyProject",
    });
  }
}

generateArchitectureReports();
```

## Configuration

### Report Options

```typescript
interface ArchitectureReportOptions {
  includeRiskScore?: boolean; // Include risk assessment section
  includeFindings?: boolean; // Include detailed findings
  includeMetrics?: boolean; // Include execution metrics
  format?: "json" | "markdown" | "html"; // Output format
  outputPath?: string; // File path for saving
  projectName?: string; // Project name for report header
  contractVersion?: string; // Contract version for report header
}
```

## Best Practices

1. **Run Early and Often** - Generate architecture reports during development to catch issues early
2. **Compare Over Time** - Track complexity and efficiency metrics across versions
3. **Review Before Audits** - Use reports to prepare for security audits
4. **Integrate with CI** - Automatically generate reports on every commit
5. **Share with Team** - Use reports as documentation for new team members

## Detected Patterns

### Storage Patterns

- **cache-candidate** - Multiple reads from same key
- **batch-candidate** - Multiple sequential operations
- **redundant-read** - Unnecessary duplicate reads
- **loop-storage** - Storage access inside loops (critical)
- **efficient** - Optimal storage usage

### Security Patterns

- **require_auth** - Stellar-native authentication
- **owner_check** - Owner-based access control
- **role_check** - Role-based access control
- **custom** - Custom authentication logic

### Vulnerability Indicators

- **missing-expiry** - Time-sensitive operations without deadline
- **front-running** - Lack of slippage protection in swaps
- **weak-randomness** - Predictable randomness sources
- **unchecked-math** - Arithmetic without overflow checks
- **reentrancy** - Potential reentrancy vulnerabilities

## Example Output

```markdown
# Soroban Contract Architecture Report

**Generated:** 2026-01-26T10:30:00Z
**Version:** 1.0.0
**Project:** TokenContract

---

## 📋 Executive Summary

**Contract Name:** OptimizedContract
**Type:** single
**Complexity:** MEDIUM
**Lines of Code:** 245
**Functions:** 12 (10 public, 2 private)
**Overall Efficiency:** GOOD

## 🔒 Security Boundaries

| Feature             | Status |
| ------------------- | ------ |
| Access Control      | ✅     |
| Access Control Type | owner  |
| Pause Circuit       | ✅     |
| Emergency Mechanism | ✅     |
| Rate Limiting       | ❌     |

### ⚠️ Vulnerability Indicators

#### WEAK-RANDOMNESS (high)

**Description:** Using predictable randomness sources
**Affected Functions:** generate_random_id
**Recommendation:** Use env.prng() for secure randomness

...
```

## API Reference

### SorobanArchitectureAnalyzer

```typescript
class SorobanArchitectureAnalyzer {
  constructor(source: string, filePath: string);

  analyze(
    findings?: Finding[],
    riskScore?: RiskScore,
    metrics?: ExecutionMetrics,
  ): SorobanArchitectureSummary;
}
```

### SorobanArchitectureReporter

```typescript
class SorobanArchitectureReporter {
  generate(
    summary: SorobanArchitectureSummary,
    options?: ArchitectureReportOptions,
  ): string;

  saveReport(
    summary: SorobanArchitectureSummary,
    options: ArchitectureReportOptions,
  ): Promise<string>;
}
```

## Contributing

To extend the analyzer with new patterns or metrics:

1. Add new types to `types.ts`
2. Implement detection logic in `architecture-analyzer.ts`
3. Add formatting in `architecture-reporter.ts`
4. Update tests in `__tests__/architecture-reporter.spec.ts`

## License

Part of the GasGuard project.
