# Organization Risk Overview

## Overview

The Organization Risk Overview system provides portfolio-level risk assessment across all repositories in an organization. It aggregates repository-level risk summaries to provide executive visibility into security posture, compliance status, and risk trends.

## Features

### Portfolio-Level Insights
- **Aggregated Risk Metrics**: Organization-wide averages, medians, and distributions
- **Risk Distribution**: Classification of repositories by risk level
- **Trend Analysis**: Organization-wide security trend direction
- **Top Risk Repositories**: Identification of highest-risk assets

### Executive Reporting
- **Key Insights**: Automated identification of concerning patterns
- **Strategic Recommendations**: Organization-level action items
- **Compliance Overview**: Cross-repository compliance tracking
- **Trend Monitoring**: Improvement vs. degradation metrics

### Multi-Repository Analysis
- Cross-repository vulnerability aggregation
- Dependency risk correlation
- Quality trend comparison
- Compliance gap identification

## Usage

### Programmatic API

```typescript
import { generateOrganizationRiskOverview } from '@gasguard/reporting/organization';

// Collect repository summaries
const repositorySummaries = await Promise.all(
  repositories.map(repo => generateRepositoryRiskSummary(repo, ...))
);

// Generate organization overview
const overview = generateOrganizationRiskOverview(
  organizationMetadata,
  repositorySummaries
);

console.log(`Average Risk Score: ${overview.metrics.averageRiskScore}/100`);
console.log(`Critical Repositories: ${overview.metrics.repositoriesCritical}`);
console.log(`Compliance Rate: ${overview.complianceOverview.complianceRate}%`);

// Export to JSON
const json = exportOrganizationRiskJSON(overview);

// Generate executive summary
const summary = generateExecutiveSummary(overview);
console.log(summary);
```

### CLI Integration

```bash
# Generate organization risk overview
gasguard org-risk --organization my-org --output org-risk.json

# Generate executive summary
gasguard org-risk --organization my-org --format summary --output summary.txt

# Filter by risk level
gasguard org-risk --organization my-org --min-risk 50 --output high-risk.json
```

### Dashboard Integration

```typescript
// Fetch organization overview for dashboard
const overview = await fetchOrganizationRiskOverview(orgId);

<OrganizationDashboard
  metrics={overview.metrics}
  distribution={overview.riskDistribution}
  topRisks={overview.topRiskRepositories}
  insights={overview.insights}
  compliance={overview.complianceOverview}
/>
```

## Metrics

### Organization Risk Metrics

```typescript
{
  averageRiskScore: number;        // Mean risk score across repositories
  medianRiskScore: number;         // Median risk score (less affected by outliers)
  highestRiskScore: number;        // Maximum risk score
  lowestRiskScore: number;         // Minimum risk score
  totalVulnerabilities: number;    // Total across all repositories
  criticalVulnerabilities: number; // Critical-severity count
  highVulnerabilities: number;     // High-severity count
  repositoriesAtRisk: number;      // Repositories with 50-74 risk score
  repositoriesCritical: number;    // Repositories with 75+ risk score
  trendsImproving: number;         // Count of repositories improving
  trendsDegrading: number;         // Count of repositories degrading
}
```

### Risk Distribution

Categorizes repositories into risk brackets:

| Category | Risk Score Range | Meaning |
|----------|------------------|---------|
| **Critical** | 75-100 | Requires immediate attention |
| **High** | 50-74 | Significant risks present |
| **Medium** | 25-49 | Moderate risks, monitor |
| **Low** | 0-24 | Acceptable risk level |

### Repository Overview

For each repository:
```typescript
{
  repositoryName: string;
  repositoryUrl: string;
  riskScore: number;
  trend: 'improving' | 'degrading' | 'stable';
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  lastAssessed: Date;
  status: 'healthy' | 'at_risk' | 'critical';
}
```

## Insights

The system automatically generates insights across four categories:

### Security Insights
- Critical repositories requiring attention
- Critical vulnerabilities across organization
- Security trend analysis

### Quality Insights
- Code quality trends
- Technical debt accumulation
- Test coverage status

### Operational Insights
- Dependency health
- Maintenance status
- Resource allocation recommendations

### Compliance Insights
- Missing security controls
- Policy coverage gaps
- Scanning enablement status

### Insight Priority Levels
- **High**: Requires immediate executive attention
- **Medium**: Should be addressed in planning
- **Low**: Informational, track over time

## Recommendations

Organization-level recommendations address:

1. **Incident Response**: Establishing teams for critical repositories
2. **Process Improvement**: Organization-wide security initiatives
3. **Resource Allocation**: Prioritization of remediation efforts
4. **Tool Adoption**: Automated scanning and monitoring
5. **Training**: Security awareness and best practices
6. **Governance**: Regular reviews and accountability

## Compliance Overview

Tracks adoption of security controls:

```typescript
{
  repositoriesWithSecurityPolicy: number;
  repositoriesWithCodeScanning: number;
  repositoriesWithDependencyScanning: number;
  repositoriesWithSecretScanning: number;
  complianceRate: number; // percentage (0-100)
}
```

Compliance rate calculation:
```
Compliance Rate = (Total Passed Checks / Total Possible Checks) * 100
```

Where each repository is checked for:
- Security policy (SECURITY.md)
- Code scanning (CodeQL/Snyk)
- Dependency scanning (Dependabot/Renovate)
- Secret scanning

## Use Cases

### Executive Reporting

Monthly risk briefings for leadership:
```typescript
const overview = generateOrganizationRiskOverview(org, summaries);
const executiveSummary = generateExecutiveSummary(overview);

await sendToExecutives({
  subject: 'Monthly Security Risk Overview',
  body: executiveSummary,
  attachments: [exportOrganizationRiskJSON(overview)],
});
```

### Portfolio Management

Identify repositories needing attention:
```typescript
const criticalRepos = overview.repositories
  .filter(r => r.status === 'critical')
  .sort((a, b) => b.riskScore - a.riskScore);

for (const repo of criticalRepos) {
  await createIncident({
    repository: repo.repositoryName,
    severity: 'high',
    description: `Repository has critical risk score: ${repo.riskScore}`,
  });
}
```

### Compliance Tracking

Monitor security control adoption:
```typescript
if (overview.complianceOverview.complianceRate < 75) {
  await scheduleComplianceInitiative({
    missingControls: identifyMissingControls(overview),
    targetDate: addMonths(new Date(), 3),
  });
}
```

### Trend Monitoring

Track improvement over time:
```typescript
const currentOverview = generateOrganizationRiskOverview(org, currentSummaries);
const previousOverview = await loadPreviousOverview();

const improvement = {
  riskScoreChange: previousOverview.metrics.averageRiskScore - currentOverview.metrics.averageRiskScore,
  vulnerabilityChange: previousOverview.metrics.totalVulnerabilities - currentOverview.metrics.totalVulnerabilities,
  complianceChange: currentOverview.complianceOverview.complianceRate - previousOverview.complianceOverview.complianceRate,
};

if (improvement.riskScoreChange < 0) {
  await alertTeam('Organization risk score increased');
}
```

## Integration Examples

### Automated Reporting

```yaml
# GitHub Actions - Weekly Organization Risk Report
name: Organization Risk Report
on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9 AM

jobs:
  risk-report:
    runs-on: ubuntu-latest
    steps:
      - name: Generate Organization Overview
        run: gasguard org-risk --organization ${{ github.repository_owner }} --output overview.json
      
      - name: Generate Executive Summary
        run: gasguard org-risk --organization ${{ github.repository_owner }} --format summary --output summary.txt
      
      - name: Send to Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload-file-path: summary.txt
```

### Dashboard Visualization

```typescript
// React Dashboard Component
function OrganizationRiskDashboard({ overview }: { overview: OrganizationRiskOverview }) {
  return (
    <div>
      <RiskScoreGauge score={overview.metrics.averageRiskScore} />
      
      <RiskDistributionChart distribution={overview.riskDistribution} />
      
      <TopRiskRepositories repos={overview.topRiskRepositories} />
      
      <InsightsPanel insights={overview.insights} />
      
      <ComplianceStatus compliance={overview.complianceOverview} />
      
      <TrendChart
        improving={overview.metrics.trendsImproving}
        degrading={overview.metrics.trendsDegrading}
      />
    </div>
  );
}
```

### Alert Configuration

```typescript
// Configure alerts based on organization metrics
const alertConfig = {
  criticalThreshold: overview.metrics.averageRiskScore > 75,
  criticalReposExcessive: overview.metrics.repositoriesCritical > 5,
  vulnerabilitiesHigh: overview.metrics.criticalVulnerabilities > 20,
  complianceLow: overview.complianceOverview.complianceRate < 60,
  trendNegative: overview.metrics.trendsDegrading > overview.metrics.trendsImproving,
};

if (Object.values(alertConfig).some(condition => condition)) {
  await sendExecutiveAlert(overview, alertConfig);
}
```

## Best Practices

### Regular Assessment
- **Weekly**: For organizations with active development
- **Monthly**: For standard monitoring
- **Quarterly**: For executive reviews

### Threshold Management
- Set organization-specific risk tolerance
- Define escalation procedures for critical status
- Track metrics against organizational goals

### Action Planning
- Schedule regular risk review meetings
- Assign ownership for critical repositories
- Track remediation progress in project management tools

### Communication
- Tailor reports for different audiences (executives, teams, security)
- Use visualizations for quick understanding
- Provide actionable recommendations, not just data

### Continuous Improvement
- Track trends over multiple periods
- Measure effectiveness of security initiatives
- Adjust strategies based on results

## API Reference

### `generateOrganizationRiskOverview(organization, repositorySummaries): OrganizationRiskOverview`

Generates comprehensive organization-wide risk overview.

**Parameters:**
- `organization`: Organization metadata
- `repositorySummaries`: Array of repository risk summaries

**Returns:** Complete `OrganizationRiskOverview` object

### `exportOrganizationRiskJSON(overview): string`

Exports overview to JSON format for storage or integration.

### `generateExecutiveSummary(overview): string`

Generates human-readable executive summary report.

## Related Documentation

- [Repository Risk Summaries](./REPOSITORY_RISK_SUMMARIES.md)
- [Findings Trend Reports](./FINDINGS_TREND_REPORTS.md)
- [Security Incident Response](./SECURITY_INCIDENT_RESPONSE.md)
- [Data and Reporting Architecture](./ARCHITECTURE.md)

---

**Version**: 1.0  
**Last Updated**: 2026-09-30  
**Maintained By**: GasGuard Data and Reporting Team
