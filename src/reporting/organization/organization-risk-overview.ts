/**
 * Organization Risk Overview
 * 
 * Provides aggregated risk assessment across multiple repositories
 * within an organization. Enables portfolio-level risk management
 * and cross-repository insights.
 */

import { RepositoryRiskSummary } from '../risk/repository-risk-summary';

export interface OrganizationMetadata {
  name: string;
  id: string;
  totalRepositories: number;
  activeRepositories: number;
  totalContributors: number;
  createdAt: Date;
  plan: 'free' | 'team' | 'enterprise';
}

export interface RepositoryRiskOverview {
  repositoryName: string;
  repositoryUrl: string;
  riskScore: number;
  trend: 'improving' | 'degrading' | 'stable';
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  lastAssessed: Date;
  status: 'healthy' | 'at_risk' | 'critical';
}

export interface OrganizationRiskMetrics {
  averageRiskScore: number;
  medianRiskScore: number;
  highestRiskScore: number;
  lowestRiskScore: number;
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  repositoriesAtRisk: number;
  repositoriesCritical: number;
  trendsImproving: number;
  trendsDegrading: number;
}

export interface RiskDistribution {
  critical: number; // Score 75-100
  high: number;     // Score 50-74
  medium: number;   // Score 25-49
  low: number;      // Score 0-24
}

export interface TopRiskRepository {
  name: string;
  riskScore: number;
  criticalIssues: string[];
  trend: 'improving' | 'degrading' | 'stable';
}

export interface OrganizationInsight {
  type: 'warning' | 'info' | 'success';
  category: 'security' | 'quality' | 'operational' | 'compliance';
  message: string;
  affectedRepositories: number;
  priority: 'high' | 'medium' | 'low';
}

export interface OrganizationRiskOverview {
  overviewId: string;
  generatedAt: Date;
  organization: OrganizationMetadata;
  metrics: OrganizationRiskMetrics;
  riskDistribution: RiskDistribution;
  repositories: RepositoryRiskOverview[];
  topRiskRepositories: TopRiskRepository[];
  insights: OrganizationInsight[];
  recommendations: string[];
  complianceOverview: {
    repositoriesWithSecurityPolicy: number;
    repositoriesWithCodeScanning: number;
    repositoriesWithDependencyScanning: number;
    repositoriesWithSecretScanning: number;
    complianceRate: number; // percentage
  };
}

/**
 * Generate organization-wide risk overview
 */
export function generateOrganizationRiskOverview(
  organization: OrganizationMetadata,
  repositorySummaries: RepositoryRiskSummary[],
): OrganizationRiskOverview {
  const overviewId = `ORG-RISK-${organization.id}-${Date.now()}`;
  
  const repositories = repositorySummaries.map(summary => ({
    repositoryName: summary.repository.name,
    repositoryUrl: summary.repository.url,
    riskScore: summary.riskScore.overall,
    trend: summary.riskScore.trend,
    criticalVulnerabilities: summary.securityPosture.criticalVulnerabilities,
    highVulnerabilities: summary.securityPosture.highVulnerabilities,
    lastAssessed: summary.generatedAt,
    status: determineRepositoryStatus(summary.riskScore.overall),
  }));

  const metrics = calculateOrganizationMetrics(repositorySummaries);
  const riskDistribution = calculateRiskDistribution(repositorySummaries);
  const topRiskRepositories = identifyTopRiskRepositories(repositorySummaries);
  const insights = generateOrganizationInsights(repositorySummaries, metrics);
  const recommendations = generateOrganizationRecommendations(metrics, insights);
  const complianceOverview = calculateComplianceOverview(repositorySummaries);

  return {
    overviewId,
    generatedAt: new Date(),
    organization,
    metrics,
    riskDistribution,
    repositories,
    topRiskRepositories,
    insights,
    recommendations,
    complianceOverview,
  };
}

/**
 * Determine repository status based on risk score
 */
function determineRepositoryStatus(riskScore: number): 'healthy' | 'at_risk' | 'critical' {
  if (riskScore >= 75) return 'critical';
  if (riskScore >= 50) return 'at_risk';
  return 'healthy';
}

/**
 * Calculate organization-wide metrics
 */
function calculateOrganizationMetrics(
  summaries: RepositoryRiskSummary[],
): OrganizationRiskMetrics {
  if (summaries.length === 0) {
    return {
      averageRiskScore: 0,
      medianRiskScore: 0,
      highestRiskScore: 0,
      lowestRiskScore: 0,
      totalVulnerabilities: 0,
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
      repositoriesAtRisk: 0,
      repositoriesCritical: 0,
      trendsImproving: 0,
      trendsDegrading: 0,
    };
  }

  const riskScores = summaries.map(s => s.riskScore.overall);
  const averageRiskScore = riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length;
  
  const sortedScores = [...riskScores].sort((a, b) => a - b);
  const medianRiskScore = sortedScores[Math.floor(sortedScores.length / 2)];
  
  const highestRiskScore = Math.max(...riskScores);
  const lowestRiskScore = Math.min(...riskScores);

  const totalVulnerabilities = summaries.reduce((sum, s) => sum + s.securityPosture.totalVulnerabilities, 0);
  const criticalVulnerabilities = summaries.reduce((sum, s) => sum + s.securityPosture.criticalVulnerabilities, 0);
  const highVulnerabilities = summaries.reduce((sum, s) => sum + s.securityPosture.highVulnerabilities, 0);

  const repositoriesAtRisk = summaries.filter(s => s.riskScore.overall >= 50 && s.riskScore.overall < 75).length;
  const repositoriesCritical = summaries.filter(s => s.riskScore.overall >= 75).length;

  const trendsImproving = summaries.filter(s => s.riskScore.trend === 'improving').length;
  const trendsDegrading = summaries.filter(s => s.riskScore.trend === 'degrading').length;

  return {
    averageRiskScore: Math.round(averageRiskScore),
    medianRiskScore,
    highestRiskScore,
    lowestRiskScore,
    totalVulnerabilities,
    criticalVulnerabilities,
    highVulnerabilities,
    repositoriesAtRisk,
    repositoriesCritical,
    trendsImproving,
    trendsDegrading,
  };
}

/**
 * Calculate risk distribution
 */
function calculateRiskDistribution(
  summaries: RepositoryRiskSummary[],
): RiskDistribution {
  return {
    critical: summaries.filter(s => s.riskScore.overall >= 75).length,
    high: summaries.filter(s => s.riskScore.overall >= 50 && s.riskScore.overall < 75).length,
    medium: summaries.filter(s => s.riskScore.overall >= 25 && s.riskScore.overall < 50).length,
    low: summaries.filter(s => s.riskScore.overall < 25).length,
  };
}

/**
 * Identify top risk repositories
 */
function identifyTopRiskRepositories(
  summaries: RepositoryRiskSummary[],
): TopRiskRepository[] {
  return summaries
    .sort((a, b) => b.riskScore.overall - a.riskScore.overall)
    .slice(0, 10)
    .map(summary => ({
      name: summary.repository.name,
      riskScore: summary.riskScore.overall,
      criticalIssues: summary.criticalActions,
      trend: summary.riskScore.trend,
    }));
}

/**
 * Generate organization-level insights
 */
function generateOrganizationInsights(
  summaries: RepositoryRiskSummary[],
  metrics: OrganizationRiskMetrics,
): OrganizationInsight[] {
  const insights: OrganizationInsight[] = [];

  // Critical repositories insight
  if (metrics.repositoriesCritical > 0) {
    insights.push({
      type: 'warning',
      category: 'security',
      message: `${metrics.repositoriesCritical} repositories have critical risk levels requiring immediate attention`,
      affectedRepositories: metrics.repositoriesCritical,
      priority: 'high',
    });
  }

  // Critical vulnerabilities insight
  if (metrics.criticalVulnerabilities > 0) {
    insights.push({
      type: 'warning',
      category: 'security',
      message: `${metrics.criticalVulnerabilities} critical vulnerabilities detected across the organization`,
      affectedRepositories: summaries.filter(s => s.securityPosture.criticalVulnerabilities > 0).length,
      priority: 'high',
    });
  }

  // Degrading trends insight
  if (metrics.trendsDegrading > metrics.trendsImproving) {
    insights.push({
      type: 'warning',
      category: 'operational',
      message: `More repositories show degrading trends (${metrics.trendsDegrading}) than improving (${metrics.trendsImproving})`,
      affectedRepositories: metrics.trendsDegrading,
      priority: 'medium',
    });
  }

  // Positive trends insight
  if (metrics.trendsImproving > summaries.length / 2) {
    insights.push({
      type: 'success',
      category: 'operational',
      message: `Majority of repositories (${metrics.trendsImproving}/${summaries.length}) show improving risk trends`,
      affectedRepositories: metrics.trendsImproving,
      priority: 'low',
    });
  }

  // Average risk insight
  if (metrics.averageRiskScore > 50) {
    insights.push({
      type: 'warning',
      category: 'security',
      message: `Organization average risk score (${metrics.averageRiskScore}) is in the HIGH range`,
      affectedRepositories: summaries.length,
      priority: 'high',
    });
  } else if (metrics.averageRiskScore < 25) {
    insights.push({
      type: 'success',
      category: 'security',
      message: `Organization maintains a LOW average risk score (${metrics.averageRiskScore})`,
      affectedRepositories: summaries.length,
      priority: 'low',
    });
  }

  // Compliance insights
  const reposWithoutScanning = summaries.filter(s => 
    !s.complianceStatus.hasCodeScanning || 
    !s.complianceStatus.hasDependencyScanning
  ).length;

  if (reposWithoutScanning > summaries.length / 2) {
    insights.push({
      type: 'info',
      category: 'compliance',
      message: `${reposWithoutScanning} repositories lack automated security scanning`,
      affectedRepositories: reposWithoutScanning,
      priority: 'medium',
    });
  }

  return insights;
}

/**
 * Generate organization-level recommendations
 */
function generateOrganizationRecommendations(
  metrics: OrganizationRiskMetrics,
  insights: OrganizationInsight[],
): string[] {
  const recommendations: string[] = [];

  // Critical repositories
  if (metrics.repositoriesCritical > 0) {
    recommendations.push(`Establish incident response team to address ${metrics.repositoriesCritical} critical-risk repositories`);
  }

  // Risk distribution
  if (metrics.repositoriesAtRisk + metrics.repositoriesCritical > metrics.repositoriesAtRisk + metrics.repositoriesCritical) {
    recommendations.push('Implement organization-wide security review process');
  }

  // Trends
  if (metrics.trendsDegrading > 3) {
    recommendations.push('Conduct retrospective to identify causes of degrading security trends');
  }

  // Vulnerabilities
  if (metrics.criticalVulnerabilities > 10) {
    recommendations.push('Prioritize vulnerability remediation with dedicated sprint capacity');
  }

  // Compliance
  const complianceInsight = insights.find(i => i.category === 'compliance');
  if (complianceInsight) {
    recommendations.push('Roll out automated security scanning (CodeQL, Dependabot) across all repositories');
  }

  // General recommendations
  if (metrics.averageRiskScore > 40) {
    recommendations.push('Establish security champions program to improve organization-wide security posture');
    recommendations.push('Implement regular security training for development teams');
  }

  recommendations.push('Schedule quarterly organization risk reviews with stakeholders');
  recommendations.push('Set up automated alerting for repositories entering critical risk status');

  return recommendations.slice(0, 8);
}

/**
 * Calculate compliance overview
 */
function calculateComplianceOverview(
  summaries: RepositoryRiskSummary[],
): OrganizationRiskOverview['complianceOverview'] {
  if (summaries.length === 0) {
    return {
      repositoriesWithSecurityPolicy: 0,
      repositoriesWithCodeScanning: 0,
      repositoriesWithDependencyScanning: 0,
      repositoriesWithSecretScanning: 0,
      complianceRate: 0,
    };
  }

  const repositoriesWithSecurityPolicy = summaries.filter(s => s.complianceStatus.hasSecurityPolicy).length;
  const repositoriesWithCodeScanning = summaries.filter(s => s.complianceStatus.hasCodeScanning).length;
  const repositoriesWithDependencyScanning = summaries.filter(s => s.complianceStatus.hasDependencyScanning).length;
  const repositoriesWithSecretScanning = summaries.filter(s => s.complianceStatus.hasSecretScanning).length;

  // Calculate overall compliance rate
  const totalChecks = summaries.length * 4; // 4 compliance checks per repository
  const passedChecks = repositoriesWithSecurityPolicy + repositoriesWithCodeScanning + 
                       repositoriesWithDependencyScanning + repositoriesWithSecretScanning;
  const complianceRate = (passedChecks / totalChecks) * 100;

  return {
    repositoriesWithSecurityPolicy,
    repositoriesWithCodeScanning,
    repositoriesWithDependencyScanning,
    repositoriesWithSecretScanning,
    complianceRate: Math.round(complianceRate),
  };
}

/**
 * Export organization risk overview to JSON
 */
export function exportOrganizationRiskJSON(overview: OrganizationRiskOverview): string {
  return JSON.stringify(overview, null, 2);
}

/**
 * Generate executive summary report
 */
export function generateExecutiveSummary(overview: OrganizationRiskOverview): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('      ORGANIZATION RISK OVERVIEW - EXECUTIVE SUMMARY');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Organization: ${overview.organization.name}`);
  lines.push(`Generated: ${overview.generatedAt.toISOString()}`);
  lines.push(`Total Repositories: ${overview.organization.totalRepositories}`);
  lines.push('');

  lines.push('─── RISK METRICS ───');
  lines.push(`Average Risk Score: ${overview.metrics.averageRiskScore}/100`);
  lines.push(`Repositories at Critical Risk: ${overview.metrics.repositoriesCritical}`);
  lines.push(`Repositories at Risk: ${overview.metrics.repositoriesAtRisk}`);
  lines.push(`Total Critical Vulnerabilities: ${overview.metrics.criticalVulnerabilities}`);
  lines.push(`Total High Vulnerabilities: ${overview.metrics.highVulnerabilities}`);
  lines.push('');

  lines.push('─── RISK DISTRIBUTION ───');
  lines.push(`🔴 Critical (75-100): ${overview.riskDistribution.critical} repositories`);
  lines.push(`🟠 High (50-74): ${overview.riskDistribution.high} repositories`);
  lines.push(`🟡 Medium (25-49): ${overview.riskDistribution.medium} repositories`);
  lines.push(`🟢 Low (0-24): ${overview.riskDistribution.low} repositories`);
  lines.push('');

  lines.push('─── TRENDS ───');
  lines.push(`📈 Improving: ${overview.metrics.trendsImproving} repositories`);
  lines.push(`📉 Degrading: ${overview.metrics.trendsDegrading} repositories`);
  lines.push('');

  if (overview.topRiskRepositories.length > 0) {
    lines.push('─── TOP RISK REPOSITORIES ───');
    overview.topRiskRepositories.slice(0, 5).forEach((repo, idx) => {
      lines.push(`${idx + 1}. ${repo.name} - Risk Score: ${repo.riskScore}/100 (${repo.trend})`);
    });
    lines.push('');
  }

  if (overview.insights.filter(i => i.priority === 'high').length > 0) {
    lines.push('─── KEY INSIGHTS ───');
    overview.insights
      .filter(i => i.priority === 'high')
      .forEach(insight => lines.push(`  ⚠️  ${insight.message}`));
    lines.push('');
  }

  lines.push('─── TOP RECOMMENDATIONS ───');
  overview.recommendations.slice(0, 5).forEach((rec, idx) => {
    lines.push(`${idx + 1}. ${rec}`);
  });
  lines.push('');

  lines.push('─── COMPLIANCE OVERVIEW ───');
  lines.push(`Overall Compliance Rate: ${overview.complianceOverview.complianceRate}%`);
  lines.push(`Security Policies: ${overview.complianceOverview.repositoriesWithSecurityPolicy}/${overview.organization.totalRepositories}`);
  lines.push(`Code Scanning: ${overview.complianceOverview.repositoriesWithCodeScanning}/${overview.organization.totalRepositories}`);
  lines.push(`Dependency Scanning: ${overview.complianceOverview.repositoriesWithDependencyScanning}/${overview.organization.totalRepositories}`);
  lines.push('');

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

export default {
  generateOrganizationRiskOverview,
  exportOrganizationRiskJSON,
  generateExecutiveSummary,
};
