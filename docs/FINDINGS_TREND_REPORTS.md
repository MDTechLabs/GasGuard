# Findings Trend Reports

## Overview

The Findings Trend Reporting system provides comprehensive analytics on security findings over time. It tracks patterns, identifies trends, and helps teams understand the effectiveness of their remediation efforts.

## Features

### Trend Analysis
- **Time Series Data**: Track findings over time with daily granularity
- **Severity Distribution**: Monitor changes in critical, high, medium, and low severity findings
- **Category Trends**: Analyze trends by finding category (security, performance, maintainability)
- **Top Issues**: Identify the most frequent and impactful issues

### Remediation Metrics
- **Average Time to Resolve**: Mean time from detection to resolution
- **Median Time to Resolve**: Median resolution time (less affected by outliers)
- **Resolution Rate**: Percentage of findings resolved in the period
- **Velocity Tracking**: Monitor the rate of new vs. resolved findings

### Automated Insights
- Trend direction identification (increasing, decreasing, stable)
- Percentage change calculations
- Actionable recommendations based on data
- Highlighting of concerning patterns

## Usage

### Programmatic API

```typescript
import { generateTrendReport, exportTrendReportJSON, exportTrendReportCSV } from '@gasguard/reporting/trend';

// Generate a trend report
const findings = [/* array of findings */];
const startDate = new Date('2026-09-01');
const endDate = new Date('2026-09-30');

const report = generateTrendReport(findings, startDate, endDate);

// Access report data
console.log(`Total findings: ${report.summary.totalFindings}`);
console.log(`Resolution rate: ${report.remediationMetrics.resolutionRate}%`);
console.log(`Insights: ${report.insights.join(', ')}`);

// Export to JSON
const jsonReport = exportTrendReportJSON(report);
fs.writeFileSync('trend-report.json', jsonReport);

// Export to CSV
const csvReport = exportTrendReportCSV(report);
fs.writeFileSync('trend-report.csv', csvReport);
```

### CLI Integration

```bash
# Generate a trend report for the last 30 days
gasguard trends --period 30d --output report.json

# Generate report with custom date range
gasguard trends --start 2026-09-01 --end 2026-09-30 --format csv

# Generate report with filtering
gasguard trends --severity critical,high --category security --output critical-security.json
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Generate Findings Trend Report
  run: |
    gasguard trends --period 7d --output trend-report.json
    
- name: Upload Trend Report
  uses: actions/upload-artifact@v3
  with:
    name: trend-report
    path: trend-report.json
```

## Report Structure

### Summary Section
```typescript
{
  totalFindings: number;        // Total findings in period
  newFindings: number;          // Newly detected findings
  resolvedFindings: number;     // Findings resolved in period
  openFindings: number;         // Currently open findings
  netChange: number;            // Net change (new - resolved)
  netChangePercentage: number;  // Percentage change vs previous period
}
```

### Time Series Data
```typescript
{
  date: Date;
  totalFindings: number;
  openFindings: number;
  resolvedFindings: number;
  newFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
}
```

### Category Trends
```typescript
{
  category: string;
  dataPoints: Array<{ date: Date; count: number }>;
  trend: 'increasing' | 'decreasing' | 'stable';
  percentageChange: number;
}
```

### Remediation Metrics
```typescript
{
  averageTimeToResolve: number;      // in days
  medianTimeToResolve: number;       // in days
  resolutionRate: number;            // percentage
  findingsResolvedInPeriod: number;
  findingsOpenedInPeriod: number;
}
```

## Trend Detection Algorithm

The system uses a moving average algorithm to determine trend direction:

1. **Data Partitioning**: Split the time series data into two equal halves
2. **Average Calculation**: Calculate the mean for each half
3. **Threshold Comparison**: Compare the difference against a 10% threshold
4. **Classification**:
   - **Increasing**: Second half average > first half by >10%
   - **Decreasing**: Second half average < first half by >10%
   - **Stable**: Difference within ±10%

## Insights Generation

The system automatically generates insights based on:

- **Overall trends**: Significant increases or decreases in total findings
- **Category analysis**: Identification of categories with concerning trends
- **Remediation performance**: Assessment of resolution rates and times
- **Top issues**: Highlighting of frequent or increasing issues

Example insights:
- "Findings increased by 23.5% over the period."
- "Categories showing increasing trends: security, performance."
- "Remediation rate of 45.2% needs improvement."
- "Average time to resolve (42.3 days) is high. Consider prioritizing critical findings."

## Best Practices

### Reporting Frequency
- **Daily**: For active development periods
- **Weekly**: For standard monitoring
- **Monthly**: For executive summaries and long-term trends

### Trend Period Selection
- **7 days**: Short-term sprint-level insights
- **30 days**: Monthly performance tracking
- **90 days**: Quarterly trend analysis
- **365 days**: Year-over-year comparison

### Actionable Metrics
Focus on these key indicators:
1. **Net change trend**: Are findings accumulating or being resolved?
2. **Resolution rate**: Is the team keeping up with new findings?
3. **Average time to resolve**: Are critical issues being addressed quickly?
4. **Top issues trend**: Are the same issues recurring?

### Integration with CI/CD

1. **Automated Reports**: Generate reports on every merge to main
2. **Trend Alerts**: Set up notifications for concerning trends
3. **Quality Gates**: Fail builds if findings increase beyond threshold
4. **Historical Tracking**: Store reports for long-term analysis

## Visualization Recommendations

### Time Series Charts
- Line chart for overall finding counts over time
- Stacked area chart for severity distribution
- Bar chart for daily new vs. resolved findings

### Trend Indicators
- Arrow icons for trend direction (↑ increasing, ↓ decreasing, → stable)
- Color coding: red for increasing, green for decreasing, gray for stable
- Percentage badges showing the magnitude of change

### Dashboard Widgets
- KPI cards for summary metrics
- Sparklines for quick trend visualization
- Heat maps for category trends
- Gauge charts for resolution rates

## API Reference

### `generateTrendReport(findings, startDate, endDate): TrendReport`
Generates a comprehensive trend report for the specified period.

**Parameters:**
- `findings`: Array of Finding objects
- `startDate`: Start of the analysis period
- `endDate`: End of the analysis period

**Returns:** `TrendReport` object with all trend data and insights

### `exportTrendReportJSON(report): string`
Exports a trend report to JSON format.

**Parameters:**
- `report`: TrendReport object

**Returns:** JSON string representation of the report

### `exportTrendReportCSV(report): string`
Exports a trend report to CSV format (time series data only).

**Parameters:**
- `report`: TrendReport object

**Returns:** CSV string with time series data

## Data Requirements

### Finding Object Structure
```typescript
{
  id: string;               // Unique finding identifier
  ruleId: string;           // Rule that detected the finding
  severity: string;         // critical | high | medium | low | info
  category: string;         // Finding category (security, performance, etc.)
  filePath: string;         // Location of the finding
  line: number;             // Line number
  message: string;          // Finding description
  detectedAt: Date;         // Detection timestamp
  resolvedAt?: Date;        // Resolution timestamp (if resolved)
  status: string;           // open | resolved | false_positive | accepted_risk
}
```

## Performance Considerations

- **Large Datasets**: The system efficiently handles thousands of findings
- **Date Range**: Longer periods increase processing time linearly
- **Caching**: Consider caching reports for frequently accessed date ranges
- **Incremental Updates**: For real-time dashboards, use incremental updates rather than full regeneration

## Future Enhancements

- [ ] Predictive analytics using historical trends
- [ ] Anomaly detection for unusual patterns
- [ ] Comparison reports (team vs. team, project vs. project)
- [ ] Automated alerting based on configurable thresholds
- [ ] Integration with ticketing systems (Jira, GitHub Issues)
- [ ] Machine learning-based trend classification
- [ ] Real-time streaming trend updates

## Related Documentation

- [Data and Reporting Architecture](./ARCHITECTURE.md)
- [Repository Risk Summaries](./REPOSITORY_RISK_SUMMARIES.md)
- [Organization Risk Overview](./ORGANIZATION_RISK_OVERVIEW.md)
- [Audit Logging System](./AUDIT_LOGGING_SYSTEM.md)

---

**Version**: 1.0  
**Last Updated**: 2026-09-30  
**Maintained By**: GasGuard Data and Reporting Team
