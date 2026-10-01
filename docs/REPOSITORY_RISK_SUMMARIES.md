# Repository Risk Summaries

## Overview

The Repository Risk Summary system provides comprehensive risk assessment at the repository level. It aggregates security vulnerabilities, code quality metrics, dependency risks, and operational factors to produce an overall risk score with actionable recommendations.

## Features

### Multi-Dimensional Risk Assessment
- **Security Risk**: Vulnerability counts, severity distribution, exposed secrets
- **Quality Risk**: Technical debt, test coverage, code complexity
- **Operational Risk**: Dependency health, maintenance status, documentation

### Risk Scoring
- Overall risk score (0-100, where 100 = highest risk)
- Category-specific risk scores
- Trend analysis (improving, degrading, stable)
- Historical comparison

### Actionable Insights
- Critical actions requiring immediate attention
- Prioritized recommendations
- Category-specific guidance
- Compliance status assessment

## Usage

### Programmatic API

```typescript
import { generateRepositoryRiskSummary } from '@gasguard/reporting/risk';

const summary = generateRepositoryRiskSummary(
  repositoryMetadata,
  findings,
  dependencies,
  codeQualityMetrics,
  previousSummary, // optional for trend analysis
);

console.log(`Overall Risk: ${summary.riskScore.overall}/100`);
console.log(`Security Score: ${summary.securityPosture.securityScore}/100`);
console.log(`Critical Actions: ${summary.criticalActions.length}`);

// Export to JSON
const json = exportRiskSummaryJSON(summary);

// Generate human-readable report
const report = generateRiskSummaryReport(summary);
console.log(report);
```

### CLI Integration

```bash
# Generate risk summary for current repository
gasguard risk-summary --output risk-summary.json

# Generate with comparison to previous
gasguard risk-summary --compare previous-summary.json --output current-summary.json

# Generate report format
gasguard risk-summary --format report --output risk-report.txt
```

## Risk Score Calculation

### Overall Risk Score
```
Overall Risk = (Security * 0.5) + (Quality * 0.3) + (Operational * 0.2)
```

### Security Risk
Based on:
- Critical vulnerabilities (-20 points each)
- High vulnerabilities (-10 points each)
- Medium vulnerabilities (-5 points each)
- Low vulnerabilities (-2 points each)
- Exposed secrets (-15 points each)
- Insecure dependencies (-3 points each)

### Quality Risk
Based on:
- Technical debt ratio (up to 40 points)
- Test coverage gap (up to 30 points)
- Code complexity (up to 30 points)

### Operational Risk
Based on:
- Outdated dependencies (up to 40 points)
- Deprecated dependencies (up to 60 points)

## Risk Levels

| Score | Level | Description |
|-------|-------|-------------|
| 75-100 | CRITICAL | Immediate attention required |
| 50-74 | HIGH | Significant risks present |
| 25-49 | MEDIUM | Moderate risks, monitor closely |
| 0-24 | LOW | Acceptable risk level |

## Report Structure

### Summary Section
```typescript
{
  summaryId: string;
  generatedAt: Date;
  repository: RepositoryMetadata;
  riskScore: RiskScore;
}
```

### Security Posture
```typescript
{
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  mediumVulnerabilities: number;
  lowVulnerabilities: number;
  exposedSecrets: number;
  insecureDependencies: number;
  securityScore: number; // 0-100
}
```

### Dependency Analysis
```typescript
{
  total: number;
  outdated: number;
  vulnerable: number;
  deprecated: number;
  riskyDependencies: DependencyRisk[];
}
```

### Risk Categories
Each category includes:
- Risk score (0-100)
- Risk level (critical/high/medium/low/none)
- Findings count
- Top findings
- Category-specific recommendations

## Critical Actions

The system automatically identifies critical actions based on:

1. **Critical Vulnerabilities**: Any critical-severity security findings
2. **Exposed Secrets**: Hardcoded credentials or API keys
3. **Critical Dependencies**: Dependencies with known critical CVEs
4. **High Vulnerability Count**: 5+ high-severity findings
5. **Deprecated Dependencies**: 3+ deprecated packages in use

Example output:
```
🚨 Address 2 critical security vulnerabilities immediately
🔐 Revoke and rotate 1 exposed secrets/credentials
📦 Update 3 dependencies with critical vulnerabilities
```

## Recommendations

Recommendations are generated based on:

### Security
- Automated security scanning integration
- Security code review processes
- GitHub/GitLab security feature enablement

### Quality
- Test coverage improvement targets
- Technical debt reduction initiatives
- Documentation improvements

### Operational
- Dependency update schedules
- Deprecation replacement plans
- Monitoring and alerting setup

## Compliance Assessment

The system checks for:
- ✅ Security policy (SECURITY.md)
- ✅ License file
- ✅ Contributing guidelines
- ✅ Dependency scanning (Dependabot/Renovate)
- ✅ Code scanning (CodeQL/Snyk)
- ✅ Secret scanning

## Trend Analysis

When a previous summary is provided, the system calculates:

```typescript
{
  riskScoreChange: number;      // Change in overall risk score
  findingsChange: number;        // Net change in findings count
  vulnerabilitiesChange: number; // Change in vulnerability count
}
```

Trend classification:
- **Improving**: Risk score decreased by >5 points
- **Degrading**: Risk score increased by >5 points
- **Stable**: Risk score changed by ≤5 points

## Integration Examples

### CI/CD Pipeline

```yaml
# GitHub Actions
- name: Generate Risk Summary
  run: gasguard risk-summary --output risk-summary.json

- name: Check Risk Threshold
  run: |
    RISK_SCORE=$(jq '.riskScore.overall' risk-summary.json)
    if [ "$RISK_SCORE" -gt 75 ]; then
      echo "::error::Risk score ($RISK_SCORE) exceeds threshold (75)"
      exit 1
    fi
```

### Scheduled Monitoring

```yaml
# Weekly risk summary
schedule:
  - cron: '0 9 * * 1'  # Every Monday at 9 AM

jobs:
  risk-assessment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate Risk Summary
        run: gasguard risk-summary --compare last-week.json --output this-week.json
      - name: Post to Slack
        if: summary.riskScore.trend == 'degrading'
        run: ./notify-slack.sh
```

### Dashboard Integration

```typescript
// Fetch and display risk summary in dashboard
const summary = await fetchRiskSummary(repoId);

<RiskScoreCard
  score={summary.riskScore.overall}
  trend={summary.riskScore.trend}
  previousScore={summary.riskScore.previousScore}
/>

<CriticalActions actions={summary.criticalActions} />
<SecurityPosture posture={summary.securityPosture} />
<Recommendations items={summary.recommendations} />
```

## Best Practices

### Regular Assessment
- Run risk summaries weekly for active development
- Monthly for stable/maintenance projects
- After major changes or releases

### Threshold Management
- Set organizational risk tolerance levels
- Fail CI builds if critical thresholds exceeded
- Escalate high-risk summaries to security team

### Trend Monitoring
- Track risk score over time
- Identify patterns and recurring issues
- Measure effectiveness of security initiatives

### Action Planning
- Prioritize critical actions first
- Schedule remediation work in sprints
- Re-assess after fixes to confirm improvement

## API Reference

### `generateRepositoryRiskSummary(repository, findings, dependencies, codeQuality, previousSummary?): RepositoryRiskSummary`

Generates a comprehensive repository risk summary.

**Parameters:**
- `repository`: Repository metadata
- `findings`: Array of security and quality findings
- `dependencies`: Array of dependency risk assessments
- `codeQuality`: Code quality metrics
- `previousSummary`: Optional previous summary for trend analysis

**Returns:** Complete `RepositoryRiskSummary` object

### `exportRiskSummaryJSON(summary): string`

Exports a risk summary to JSON format.

### `generateRiskSummaryReport(summary): string`

Generates a human-readable text report.

## Related Documentation

- [Findings Trend Reports](./FINDINGS_TREND_REPORTS.md)
- [Organization Risk Overview](./ORGANIZATION_RISK_OVERVIEW.md)
- [Security Incident Response](./SECURITY_INCIDENT_RESPONSE.md)
- [Data and Reporting Architecture](./ARCHITECTURE.md)

---

**Version**: 1.0  
**Last Updated**: 2026-09-30  
**Maintained By**: GasGuard Data and Reporting Team
