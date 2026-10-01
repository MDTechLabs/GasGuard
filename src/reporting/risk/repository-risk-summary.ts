/**
 * Repository Risk Summary
 * 
 * Aggregates and reports on security, quality, and operational risks
 * at the repository level. Provides risk scoring, trend analysis,
 * and actionable recommendations.
 */

export interface RiskFinding {
  id: string;
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'performance' | 'maintainability' | 'reliability';
  filePath: string;
  line: number;
  message: string;
  cveId?: string;
  cvssScore?: number;
  detectedAt: Date;
  status: 'open' | 'resolved' | 'mitigated' | 'accepted';
}

export interface DependencyRisk {
  name: string;
  version: string;
  vulnerabilities: number;
  highestSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  latestVersion?: string;
  isDeprecated: boolean;
  lastUpdated: Date;
}

export interface CodeQualityMetrics {
  linesOfCode: number;
  technicalDebtRatio: number; // percentage
  codeSmells: number;
  duplicatedLines: number;
  complexity: number;
  testCoverage: number; // percentage
  documentationCoverage: number; // percentage
}

export interface SecurityPosture {
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  mediumVulnerabilities: number;
  lowVulnerabilities: number;
  exposedSecrets: number;
  insecureDependencies: number;
  securityScore: number; // 0-100
}

export interface RiskScore {
  overall: number; // 0-100 (100 = highest risk)
  security: number;
  quality: number;
  operational: number;
  trend: 'improving' | 'degrading' | 'stable';
  previousScore?: number;
}

export interface RepositoryMetadata {
  name: string;
  url: string;
  defaultBranch: string;
  lastCommit: Date;
  contributors: number;
  totalCommits: number;
  openIssues: number;
  openPullRequests: number;
  languages: Record<string, number>; // language: lines of code
}

export interface RiskCategory {
  name: string;
  score: number; // 0-100
  level: 'critical' | 'high' | 'medium' | 'low' | 'none';
  findingsCount: number;
  topFindings: RiskFinding[];
  recommendations: string[];
}

export interface RepositoryRiskSummary {
  summaryId: string;
  generatedAt: Date;
  repository: RepositoryMetadata;
  riskScore: RiskScore;
  securityPosture: SecurityPosture;
  codeQuality: CodeQualityMetrics;
  dependencies: {
    total: number;
    outdated: number;
    vulnerable: number;
    deprecated: number;
    riskyDependencies: DependencyRisk[];
  };
  riskCategories: RiskCategory[];
  criticalActions: string[];
  recommendations: string[];
  complianceStatus: {
    hasSecurityPolicy: boolean;
    hasLicenseFile: boolean;
    hasContributingGuide: boolean;
    hasDependencyScanning: boolean;
    hasCodeScanning: boolean;
    hasSecretScanning: boolean;
  };
  trend: {
    riskScoreChange: number;
    findingsChange: number;
    vulnerabilitiesChange: number;
  };
}

/**
 * Generate repository risk summary
 */
export function generateRepositoryRiskSummary(
  repository: RepositoryMetadata,
  findings: RiskFinding[],
  dependencies: DependencyRisk[],
  codeQuality: CodeQualityMetrics,
  previousSummary?: RepositoryRiskSummary,
): RepositoryRiskSummary {
  const summaryId = `RISK-${repository.name}-${Date.now()}`;
  const securityPosture = calculateSecurityPosture(findings, dependencies);
  const riskScore = calculateRiskScore(findings, dependencies, codeQuality, securityPosture, previousSummary);
  const riskCategories = categorizeRisks(findings);
  const criticalActions = identifyCriticalActions(findings, dependencies, securityPosture);
  const recommendations = generateRecommendations(riskScore, securityPosture, codeQuality, dependencies);
  const complianceStatus = assessCompliance(repository);

  const trend = calculateTrend(riskScore, findings, previousSummary);

  return {
    summaryId,
    generatedAt: new Date(),
    repository,
    riskScore,
    securityPosture,
    codeQuality,
    dependencies: {
      total: dependencies.length,
      outdated: dependencies.filter(d => d.latestVersion && d.version !== d.latestVersion).length,
      vulnerable: dependencies.filter(d => d.vulnerabilities > 0).length,
      deprecated: dependencies.filter(d => d.isDeprecated).length,
      riskyDependencies: dependencies
        .filter(d => d.vulnerabilities > 0 || d.isDeprecated)
        .sort((a, b) => b.vulnerabilities - a.vulnerabilities)
        .slice(0, 10),
    },
    riskCategories,
    criticalActions,
    recommendations,
    complianceStatus,
    trend,
  };
}

/**
 * Calculate security posture
 */
function calculateSecurityPosture(
  findings: RiskFinding[],
  dependencies: DependencyRisk[],
): SecurityPosture {
  const securityFindings = findings.filter(f => f.category === 'security');
  
  const criticalVulnerabilities = securityFindings.filter(f => f.severity === 'critical').length;
  const highVulnerabilities = securityFindings.filter(f => f.severity === 'high').length;
  const mediumVulnerabilities = securityFindings.filter(f => f.severity === 'medium').length;
  const lowVulnerabilities = securityFindings.filter(f => f.severity === 'low').length;

  const exposedSecrets = securityFindings.filter(f => 
    f.message.toLowerCase().includes('secret') || 
    f.message.toLowerCase().includes('credential') ||
    f.message.toLowerCase().includes('key')
  ).length;

  const insecureDependencies = dependencies.filter(d => d.vulnerabilities > 0).length;

  // Calculate security score (0-100, 100 = best)
  let securityScore = 100;
  securityScore -= criticalVulnerabilities * 20;
  securityScore -= highVulnerabilities * 10;
  securityScore -= mediumVulnerabilities * 5;
  securityScore -= lowVulnerabilities * 2;
  securityScore -= exposedSecrets * 15;
  securityScore -= insecureDependencies * 3;
  securityScore = Math.max(0, Math.min(100, securityScore));

  return {
    totalVulnerabilities: securityFindings.length,
    criticalVulnerabilities,
    highVulnerabilities,
    mediumVulnerabilities,
    lowVulnerabilities,
    exposedSecrets,
    insecureDependencies,
    securityScore,
  };
}

/**
 * Calculate overall risk score
 */
function calculateRiskScore(
  findings: RiskFinding[],
  dependencies: DependencyRisk[],
  codeQuality: CodeQualityMetrics,
  securityPosture: SecurityPosture,
  previousSummary?: RepositoryRiskSummary,
): RiskScore {
  // Security risk (0-100, 100 = highest risk)
  const securityRisk = 100 - securityPosture.securityScore;

  // Quality risk based on code quality metrics
  let qualityRisk = 0;
  qualityRisk += Math.min(40, codeQuality.technicalDebtRatio);
  qualityRisk += Math.min(30, (100 - codeQuality.testCoverage) * 0.3);
  qualityRisk += Math.min(30, codeQuality.complexity / 100);

  // Operational risk based on dependencies and maintenance
  let operationalRisk = 0;
  const outdatedRatio = dependencies.filter(d => d.latestVersion && d.version !== d.latestVersion).length / (dependencies.length || 1);
  const deprecatedRatio = dependencies.filter(d => d.isDeprecated).length / (dependencies.length || 1);
  operationalRisk += outdatedRatio * 40;
  operationalRisk += deprecatedRatio * 60;

  // Overall risk (weighted average)
  const overallRisk = (securityRisk * 0.5) + (qualityRisk * 0.3) + (operationalRisk * 0.2);

  // Determine trend
  let trend: 'improving' | 'degrading' | 'stable' = 'stable';
  if (previousSummary) {
    const diff = overallRisk - previousSummary.riskScore.overall;
    if (diff > 5) trend = 'degrading';
    else if (diff < -5) trend = 'improving';
  }

  return {
    overall: Math.round(overallRisk),
    security: Math.round(securityRisk),
    quality: Math.round(qualityRisk),
    operational: Math.round(operationalRisk),
    trend,
    previousScore: previousSummary?.riskScore.overall,
  };
}

/**
 * Categorize risks by type
 */
function categorizeRisks(findings: RiskFinding[]): RiskCategory[] {
  const categories = ['security', 'performance', 'maintainability', 'reliability'] as const;
  
  return categories.map(category => {
    const categoryFindings = findings.filter(f => f.category === category);
    const criticalCount = categoryFindings.filter(f => f.severity === 'critical').length;
    const highCount = categoryFindings.filter(f => f.severity === 'high').length;

    // Calculate category risk score
    let score = 0;
    score += criticalCount * 25;
    score += highCount * 15;
    score += categoryFindings.filter(f => f.severity === 'medium').length * 8;
    score += categoryFindings.filter(f => f.severity === 'low').length * 3;
    score = Math.min(100, score);

    // Determine risk level
    let level: 'critical' | 'high' | 'medium' | 'low' | 'none' = 'none';
    if (score >= 75 || criticalCount > 0) level = 'critical';
    else if (score >= 50 || highCount >= 3) level = 'high';
    else if (score >= 25) level = 'medium';
    else if (score > 0) level = 'low';

    // Get top findings
    const topFindings = categoryFindings
      .sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      })
      .slice(0, 5);

    // Generate recommendations
    const recommendations = generateCategoryRecommendations(category, categoryFindings);

    return {
      name: category,
      score,
      level,
      findingsCount: categoryFindings.length,
      topFindings,
      recommendations,
    };
  });
}

/**
 * Identify critical actions needed
 */
function identifyCriticalActions(
  findings: RiskFinding[],
  dependencies: DependencyRisk[],
  securityPosture: SecurityPosture,
): string[] {
  const actions: string[] = [];

  if (securityPosture.criticalVulnerabilities > 0) {
    actions.push(`🚨 Address ${securityPosture.criticalVulnerabilities} critical security vulnerabilities immediately`);
  }

  if (securityPosture.exposedSecrets > 0) {
    actions.push(`🔐 Revoke and rotate ${securityPosture.exposedSecrets} exposed secrets/credentials`);
  }

  const criticalDeps = dependencies.filter(d => 
    d.highestSeverity === 'critical' && d.vulnerabilities > 0
  );
  if (criticalDeps.length > 0) {
    actions.push(`📦 Update ${criticalDeps.length} dependencies with critical vulnerabilities`);
  }

  if (securityPosture.highVulnerabilities >= 5) {
    actions.push(`⚠️ Remediate ${securityPosture.highVulnerabilities} high-severity vulnerabilities`);
  }

  const deprecatedDeps = dependencies.filter(d => d.isDeprecated);
  if (deprecatedDeps.length >= 3) {
    actions.push(`🔄 Replace ${deprecatedDeps.length} deprecated dependencies`);
  }

  return actions;
}

/**
 * Generate recommendations
 */
function generateRecommendations(
  riskScore: RiskScore,
  securityPosture: SecurityPosture,
  codeQuality: CodeQualityMetrics,
  dependencies: DependencyRisk[],
): string[] {
  const recommendations: string[] = [];

  // Security recommendations
  if (riskScore.security > 50) {
    recommendations.push('Implement automated security scanning in CI/CD pipeline');
    recommendations.push('Conduct security code review for high-risk areas');
  }

  if (securityPosture.securityScore < 70) {
    recommendations.push('Enable GitHub/GitLab security features (Dependabot, CodeQL, Secret Scanning)');
  }

  // Quality recommendations
  if (codeQuality.testCoverage < 70) {
    recommendations.push(`Increase test coverage from ${codeQuality.testCoverage.toFixed(1)}% to at least 70%`);
  }

  if (codeQuality.technicalDebtRatio > 30) {
    recommendations.push('Allocate time for technical debt reduction in upcoming sprints');
  }

  // Operational recommendations
  const outdatedCount = dependencies.filter(d => d.latestVersion && d.version !== d.latestVersion).length;
  if (outdatedCount > 5) {
    recommendations.push(`Update ${outdatedCount} outdated dependencies to latest stable versions`);
  }

  if (codeQuality.documentationCoverage < 50) {
    recommendations.push('Improve code documentation for better maintainability');
  }

  // Trend-based recommendations
  if (riskScore.trend === 'degrading') {
    recommendations.push('Risk score is increasing - prioritize security and quality initiatives');
  }

  return recommendations.slice(0, 8); // Limit to top 8 recommendations
}

/**
 * Generate category-specific recommendations
 */
function generateCategoryRecommendations(
  category: string,
  findings: RiskFinding[],
): string[] {
  const recommendations: string[] = [];

  if (category === 'security') {
    if (findings.some(f => f.message.includes('injection'))) {
      recommendations.push('Implement input validation and parameterized queries');
    }
    if (findings.some(f => f.message.includes('authentication') || f.message.includes('authorization'))) {
      recommendations.push('Review and strengthen authentication and authorization mechanisms');
    }
  }

  if (category === 'performance') {
    if (findings.length > 10) {
      recommendations.push('Conduct performance profiling to identify bottlenecks');
    }
    recommendations.push('Implement caching strategies for frequently accessed data');
  }

  if (category === 'maintainability') {
    recommendations.push('Refactor complex code sections to improve readability');
    recommendations.push('Reduce code duplication through abstraction');
  }

  if (category === 'reliability') {
    recommendations.push('Add error handling and recovery mechanisms');
    recommendations.push('Implement monitoring and alerting for critical paths');
  }

  return recommendations.slice(0, 3);
}

/**
 * Assess compliance status
 */
function assessCompliance(repository: RepositoryMetadata): RepositoryRiskSummary['complianceStatus'] {
  // This would normally check actual repository files
  // For now, returning placeholder values
  return {
    hasSecurityPolicy: false,
    hasLicenseFile: false,
    hasContributingGuide: false,
    hasDependencyScanning: false,
    hasCodeScanning: false,
    hasSecretScanning: false,
  };
}

/**
 * Calculate trend compared to previous summary
 */
function calculateTrend(
  riskScore: RiskScore,
  findings: RiskFinding[],
  previousSummary?: RepositoryRiskSummary,
): RepositoryRiskSummary['trend'] {
  if (!previousSummary) {
    return {
      riskScoreChange: 0,
      findingsChange: 0,
      vulnerabilitiesChange: 0,
    };
  }

  const riskScoreChange = riskScore.overall - previousSummary.riskScore.overall;
  const findingsChange = findings.length - (previousSummary.riskCategories.reduce((sum, c) => sum + c.findingsCount, 0));
  const vulnerabilitiesChange = findings.filter(f => f.category === 'security').length - 
    previousSummary.securityPosture.totalVulnerabilities;

  return {
    riskScoreChange,
    findingsChange,
    vulnerabilitiesChange,
  };
}

/**
 * Export risk summary to JSON
 */
export function exportRiskSummaryJSON(summary: RepositoryRiskSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * Generate risk summary report (human-readable)
 */
export function generateRiskSummaryReport(summary: RepositoryRiskSummary): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('         REPOSITORY RISK SUMMARY REPORT');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Repository: ${summary.repository.name}`);
  lines.push(`Generated: ${summary.generatedAt.toISOString()}`);
  lines.push(`Summary ID: ${summary.summaryId}`);
  lines.push('');

  lines.push('─── RISK SCORE ───');
  lines.push(`Overall Risk: ${summary.riskScore.overall}/100 (${getRiskLevelLabel(summary.riskScore.overall)})`);
  lines.push(`  Security: ${summary.riskScore.security}/100`);
  lines.push(`  Quality: ${summary.riskScore.quality}/100`);
  lines.push(`  Operational: ${summary.riskScore.operational}/100`);
  lines.push(`  Trend: ${summary.riskScore.trend.toUpperCase()}`);
  lines.push('');

  lines.push('─── SECURITY POSTURE ───');
  lines.push(`Security Score: ${summary.securityPosture.securityScore}/100`);
  lines.push(`Total Vulnerabilities: ${summary.securityPosture.totalVulnerabilities}`);
  lines.push(`  Critical: ${summary.securityPosture.criticalVulnerabilities}`);
  lines.push(`  High: ${summary.securityPosture.highVulnerabilities}`);
  lines.push(`  Medium: ${summary.securityPosture.mediumVulnerabilities}`);
  lines.push(`  Low: ${summary.securityPosture.lowVulnerabilities}`);
  lines.push(`Exposed Secrets: ${summary.securityPosture.exposedSecrets}`);
  lines.push(`Insecure Dependencies: ${summary.securityPosture.insecureDependencies}`);
  lines.push('');

  if (summary.criticalActions.length > 0) {
    lines.push('─── CRITICAL ACTIONS REQUIRED ───');
    summary.criticalActions.forEach(action => lines.push(`  ${action}`));
    lines.push('');
  }

  lines.push('─── TOP RECOMMENDATIONS ───');
  summary.recommendations.forEach((rec, idx) => lines.push(`  ${idx + 1}. ${rec}`));
  lines.push('');

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

function getRiskLevelLabel(score: number): string {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

export default {
  generateRepositoryRiskSummary,
  exportRiskSummaryJSON,
  generateRiskSummaryReport,
};
