# Analyzer Coverage Reporting Module

## Overview

This module provides comprehensive reporting capabilities for analyzer coverage metrics. It tracks how much of your codebase has been analyzed by GasGuard rules and identifies patterns that aren't covered by any rules.

## Quick Start

```typescript
import { CoverageReporter } from './coverage-reporter';
import { RuleCoverageAnalyzer } from '../../analysis/coverage';

// Create analyzer
const analyzer = new RuleCoverageAnalyzer();

// ... perform analysis ...

// Generate report
const reporter = new CoverageReporter();
const reportData = reporter.createReportData(
  'MyProject',
  '1.0.0',
  analyzer.getMetrics(),
  10, // files covered
  12, // total files
  1500 // analysis time
);

// Output as text
console.log(reporter.generate(reportData, { format: 'text' }));

// Save as HTML
await reporter.saveReport(reportData, './coverage-report.html', {
  format: 'html',
  includeUncoveredDetails: true
});
```

## Features

### Multiple Report Formats

- **Text**: Console-friendly format for terminal output
- **JSON**: Machine-readable format for tools and APIs
- **HTML**: Beautiful, interactive reports with styling
- **Markdown**: Documentation-friendly format

### Coverage Metrics

- Total nodes in analyzed codebase
- Number of nodes analyzed by rules
- Coverage percentage
- List of uncovered patterns

### Threshold Checking

Set minimum coverage requirements and automatically check if they're met:

```typescript
const result = await reporter.saveReport(data, outputPath, {
  thresholdPercent: 85
});

if (!result.thresholdMet) {
  console.error('Coverage below threshold!');
  process.exit(1);
}
```

### Rule Breakdown

Include detailed per-rule statistics:

```typescript
const reportData = {
  ...baseData,
  rulesCoverage: [
    {
      ruleId: 'R001',
      ruleName: 'Inefficient Storage',
      nodesAnalyzed: 50,
      nodeTypes: ['StorageCall', 'StorageWrite'],
      filesAffected: ['contract1.rs', 'contract2.rs']
    }
  ]
};

const report = reporter.generate(reportData, {
  includeRuleBreakdown: true
});
```

## API

### CoverageReporter

#### `generate(data, options?): string`

Generate a coverage report.

**Options:**
- `format`: Report format ('text' | 'json' | 'html' | 'markdown')
- `includeUncoveredDetails`: Include list of uncovered patterns (default: true)
- `includeRuleBreakdown`: Include per-rule statistics (default: false)
- `thresholdPercent`: Minimum coverage threshold (default: 80)

#### `saveReport(data, outputPath, options?): Promise<CoverageReportResult>`

Generate and save a report to a file.

**Returns:**
```typescript
{
  success: boolean;
  coveragePercent: number;
  thresholdMet: boolean;
  reportPath?: string;
  summary: string;
}
```

#### `checkThreshold(metrics, threshold): boolean`

Check if coverage meets a threshold.

#### `createReportData(...): CoverageReportData`

Create report data from coverage metrics.

## Types

### CoverageReportData

```typescript
interface CoverageReportData {
  projectName: string;
  version: string;
  timestamp: Date;
  coverage: CoverageMetrics;
  filesCovered: number;
  totalFiles: number;
  analysisTimeMs: number;
  rulesCoverage?: RuleCoverageData[];
}
```

### CoverageReportOptions

```typescript
interface CoverageReportOptions {
  format?: 'text' | 'json' | 'html' | 'markdown';
  includeUncoveredDetails?: boolean;
  includeRuleBreakdown?: boolean;
  thresholdPercent?: number;
}
```

### CoverageThreshold

```typescript
interface CoverageThreshold {
  minCoveragePercent: number;
  failOnThreshold: boolean;
}
```

## Examples

### Basic Text Report

```typescript
const reporter = new CoverageReporter();
const data = reporter.createReportData(
  'MyProject',
  '1.0.0',
  metrics,
  5,
  10,
  500
);

console.log(reporter.generate(data));
```

### HTML Report with All Details

```typescript
await reporter.saveReport(data, './report.html', {
  format: 'html',
  includeUncoveredDetails: true,
  includeRuleBreakdown: true,
  thresholdPercent: 85
});
```

### CI/CD Integration

```typescript
const result = await reporter.saveReport(data, './coverage.json', {
  format: 'json',
  thresholdPercent: 80
});

if (!result.thresholdMet) {
  console.error(`Coverage ${result.coveragePercent}% below threshold`);
  process.exit(1);
}
```

## Testing

Run the comprehensive test suite:

```bash
npm test src/reporting/coverage/coverage-reporter.spec.ts
```

Tests cover:
- All report formats (text, JSON, HTML, markdown)
- Threshold checking
- File saving
- Boundary cases (0%, 100%, empty data)
- Failure scenarios
- HTML escaping for security
- Integration scenarios

## Security

- **HTML Escaping**: All user-provided content in HTML reports is escaped to prevent XSS
- **File System**: Creates directories with appropriate permissions
- **No Code Execution**: Reports are purely data presentation, no dynamic code
- **Read-Only**: Coverage tracking never modifies source files

## Performance

- Text reports: <10ms for typical projects
- HTML reports: <50ms with full styling
- JSON reports: <5ms (serialization only)
- Memory efficient: Streams to disk, no large buffers

## Integration

### With RuleCoverageAnalyzer

```typescript
import { RuleCoverageAnalyzer } from '../../analysis/coverage';
import { CoverageReporter } from './coverage-reporter';

const analyzer = new RuleCoverageAnalyzer();

// During analysis
analyzer.registerAst(astNode);
analyzer.markAnalyzed(nodeId);
analyzer.reportUncovered('PatternName');

// After analysis
const metrics = analyzer.getMetrics();
const reporter = new CoverageReporter();
const data = reporter.createReportData('Project', '1.0', metrics, 10, 10, 1000);
await reporter.saveReport(data, './report.html');
```

### With CI/CD Pipelines

See the main [documentation](../../../docs/ANALYZER_COVERAGE_REPORTING.md) for CI/CD integration examples.

## Architecture

```
src/reporting/coverage/
├── index.ts                    # Public exports
├── types.ts                    # TypeScript interfaces
├── coverage-reporter.ts        # Main reporter implementation
├── coverage-reporter.spec.ts   # Comprehensive tests
└── README.md                   # This file
```

## Dependencies

- Node.js `fs` and `path` modules (built-in)
- `../../analysis/coverage/coverage-analyzer` (RuleCoverageAnalyzer types)

## Contributing

When adding new features:

1. Add types to `types.ts`
2. Implement in `coverage-reporter.ts`
3. Add tests to `coverage-reporter.spec.ts`
4. Update documentation
5. Ensure backward compatibility

## Changelog

### v1.0.0 (Issue #1111)
- Initial implementation
- Text, JSON, HTML, and Markdown formats
- Threshold checking
- Rule breakdown reporting
- Comprehensive test coverage

## License

MIT - See LICENSE file for details
