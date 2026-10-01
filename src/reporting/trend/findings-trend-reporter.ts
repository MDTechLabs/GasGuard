/**
 * Findings Trend Reporter
 * 
 * Analyzes and reports on security findings trends over time.
 * Provides insights into finding patterns, severity distribution changes,
 * and remediation velocity.
 */

export interface Finding {
  id: string;
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  filePath: string;
  line: number;
  message: string;
  detectedAt: Date;
  resolvedAt?: Date;
  status: 'open' | 'resolved' | 'false_positive' | 'accepted_risk';
}

export interface TrendDataPoint {
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

export interface CategoryTrend {
  category: string;
  dataPoints: Array<{
    date: Date;
    count: number;
  }>;
  trend: 'increasing' | 'decreasing' | 'stable';
  percentageChange: number;
}

export interface RemediationMetrics {
  averageTimeToResolve: number; // in days
  medianTimeToResolve: number;
  resolutionRate: number; // percentage
  findingsResolvedInPeriod: number;
  findingsOpenedInPeriod: number;
}

export interface TrendReport {
  reportId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalFindings: number;
    newFindings: number;
    resolvedFindings: number;
    openFindings: number;
    netChange: number;
    netChangePercentage: number;
  };
  severityTrends: {
    critical: CategoryTrend;
    high: CategoryTrend;
    medium: CategoryTrend;
    low: CategoryTrend;
  };
  categoryTrends: CategoryTrend[];
  topIssues: Array<{
    ruleId: string;
    count: number;
    severity: string;
    trend: 'increasing' | 'decreasing' | 'stable';
  }>;
  remediationMetrics: RemediationMetrics;
  timeSeriesData: TrendDataPoint[];
  insights: string[];
}

/**
 * Generate trend report for a given period
 */
export function generateTrendReport(
  findings: Finding[],
  startDate: Date,
  endDate: Date,
): TrendReport {
  const periodFindings = findings.filter(
    f => f.detectedAt >= startDate && f.detectedAt <= endDate,
  );

  const reportId = `TREND-${Date.now()}`;
  const timeSeriesData = generateTimeSeriesData(findings, startDate, endDate);
  const categoryTrends = analyzeCategoryTrends(findings, startDate, endDate);
  const severityTrends = analyzeSeverityTrends(findings, startDate, endDate);
  const remediationMetrics = calculateRemediationMetrics(periodFindings);
  const topIssues = identifyTopIssues(periodFindings);

  const openFindings = periodFindings.filter(f => f.status === 'open').length;
  const resolvedFindings = periodFindings.filter(f => f.resolvedAt && f.resolvedAt <= endDate).length;
  const newFindings = periodFindings.length;

  // Calculate net change compared to previous period
  const previousPeriodStart = new Date(startDate);
  previousPeriodStart.setTime(startDate.getTime() - (endDate.getTime() - startDate.getTime()));
  const previousPeriodFindings = findings.filter(
    f => f.detectedAt >= previousPeriodStart && f.detectedAt < startDate,
  ).length;
  
  const netChange = newFindings - resolvedFindings;
  const netChangePercentage = previousPeriodFindings > 0
    ? ((newFindings - previousPeriodFindings) / previousPeriodFindings) * 100
    : 0;

  const insights = generateInsights(
    timeSeriesData,
    categoryTrends,
    remediationMetrics,
    topIssues,
  );

  return {
    reportId,
    generatedAt: new Date(),
    period: { start: startDate, end: endDate },
    summary: {
      totalFindings: periodFindings.length,
      newFindings,
      resolvedFindings,
      openFindings,
      netChange,
      netChangePercentage,
    },
    severityTrends,
    categoryTrends,
    topIssues,
    remediationMetrics,
    timeSeriesData,
    insights,
  };
}

/**
 * Generate time series data points
 */
function generateTimeSeriesData(
  findings: Finding[],
  startDate: Date,
  endDate: Date,
): TrendDataPoint[] {
  const dataPoints: TrendDataPoint[] = [];
  const dayInMs = 24 * 60 * 60 * 1000;
  
  for (let date = new Date(startDate); date <= endDate; date = new Date(date.getTime() + dayInMs)) {
    const dayFindings = findings.filter(
      f => f.detectedAt.toDateString() === date.toDateString(),
    );
    
    const resolvedOnDay = findings.filter(
      f => f.resolvedAt && f.resolvedAt.toDateString() === date.toDateString(),
    ).length;

    dataPoints.push({
      date: new Date(date),
      totalFindings: dayFindings.length,
      openFindings: dayFindings.filter(f => f.status === 'open').length,
      resolvedFindings: resolvedOnDay,
      newFindings: dayFindings.length,
      criticalCount: dayFindings.filter(f => f.severity === 'critical').length,
      highCount: dayFindings.filter(f => f.severity === 'high').length,
      mediumCount: dayFindings.filter(f => f.severity === 'medium').length,
      lowCount: dayFindings.filter(f => f.severity === 'low').length,
      infoCount: dayFindings.filter(f => f.severity === 'info').length,
    });
  }

  return dataPoints;
}

/**
 * Analyze category trends
 */
function analyzeCategoryTrends(
  findings: Finding[],
  startDate: Date,
  endDate: Date,
): CategoryTrend[] {
  const categories = [...new Set(findings.map(f => f.category))];
  
  return categories.map(category => {
    const categoryFindings = findings.filter(
      f => f.category === category && f.detectedAt >= startDate && f.detectedAt <= endDate,
    );

    const dataPoints = generateCategoryDataPoints(categoryFindings, startDate, endDate);
    const trend = determineTrend(dataPoints);
    const percentageChange = calculatePercentageChange(dataPoints);

    return {
      category,
      dataPoints,
      trend,
      percentageChange,
    };
  });
}

/**
 * Analyze severity trends
 */
function analyzeSeverityTrends(
  findings: Finding[],
  startDate: Date,
  endDate: Date,
): TrendReport['severityTrends'] {
  const severities: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low'];
  const trends: any = {};

  for (const severity of severities) {
    const severityFindings = findings.filter(
      f => f.severity === severity && f.detectedAt >= startDate && f.detectedAt <= endDate,
    );

    const dataPoints = generateCategoryDataPoints(severityFindings, startDate, endDate);
    trends[severity] = {
      category: severity,
      dataPoints,
      trend: determineTrend(dataPoints),
      percentageChange: calculatePercentageChange(dataPoints),
    };
  }

  return trends;
}

/**
 * Generate data points for a category
 */
function generateCategoryDataPoints(
  findings: Finding[],
  startDate: Date,
  endDate: Date,
): Array<{ date: Date; count: number }> {
  const dataPoints: Array<{ date: Date; count: number }> = [];
  const dayInMs = 24 * 60 * 60 * 1000;
  
  for (let date = new Date(startDate); date <= endDate; date = new Date(date.getTime() + dayInMs)) {
    const count = findings.filter(
      f => f.detectedAt.toDateString() === date.toDateString(),
    ).length;
    
    dataPoints.push({ date: new Date(date), count });
  }

  return dataPoints;
}

/**
 * Determine trend direction
 */
function determineTrend(
  dataPoints: Array<{ date: Date; count: number }>,
): 'increasing' | 'decreasing' | 'stable' {
  if (dataPoints.length < 2) return 'stable';

  const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
  const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));

  const firstAvg = firstHalf.reduce((sum, dp) => sum + dp.count, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, dp) => sum + dp.count, 0) / secondHalf.length;

  const threshold = 0.1; // 10% change threshold
  const change = (secondAvg - firstAvg) / (firstAvg || 1);

  if (change > threshold) return 'increasing';
  if (change < -threshold) return 'decreasing';
  return 'stable';
}

/**
 * Calculate percentage change
 */
function calculatePercentageChange(
  dataPoints: Array<{ date: Date; count: number }>,
): number {
  if (dataPoints.length < 2) return 0;

  const firstCount = dataPoints[0].count;
  const lastCount = dataPoints[dataPoints.length - 1].count;

  if (firstCount === 0) return lastCount > 0 ? 100 : 0;
  return ((lastCount - firstCount) / firstCount) * 100;
}

/**
 * Calculate remediation metrics
 */
function calculateRemediationMetrics(findings: Finding[]): RemediationMetrics {
  const resolvedFindings = findings.filter(f => f.resolvedAt);
  
  if (resolvedFindings.length === 0) {
    return {
      averageTimeToResolve: 0,
      medianTimeToResolve: 0,
      resolutionRate: 0,
      findingsResolvedInPeriod: 0,
      findingsOpenedInPeriod: findings.length,
    };
  }

  const resolutionTimes = resolvedFindings.map(f => {
    const detected = f.detectedAt.getTime();
    const resolved = f.resolvedAt!.getTime();
    return (resolved - detected) / (1000 * 60 * 60 * 24); // Convert to days
  });

  const averageTimeToResolve = resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length;
  
  const sortedTimes = [...resolutionTimes].sort((a, b) => a - b);
  const medianTimeToResolve = sortedTimes[Math.floor(sortedTimes.length / 2)];

  const resolutionRate = (resolvedFindings.length / findings.length) * 100;

  return {
    averageTimeToResolve,
    medianTimeToResolve,
    resolutionRate,
    findingsResolvedInPeriod: resolvedFindings.length,
    findingsOpenedInPeriod: findings.length,
  };
}

/**
 * Identify top issues
 */
function identifyTopIssues(
  findings: Finding[],
): Array<{ ruleId: string; count: number; severity: string; trend: 'increasing' | 'decreasing' | 'stable' }> {
  const ruleGroups = new Map<string, Finding[]>();

  for (const finding of findings) {
    if (!ruleGroups.has(finding.ruleId)) {
      ruleGroups.set(finding.ruleId, []);
    }
    ruleGroups.get(finding.ruleId)!.push(finding);
  }

  const topIssues = Array.from(ruleGroups.entries())
    .map(([ruleId, ruleFindings]) => {
      const sortedByDate = [...ruleFindings].sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
      const midpoint = Math.floor(sortedByDate.length / 2);
      const firstHalf = sortedByDate.slice(0, midpoint).length;
      const secondHalf = sortedByDate.slice(midpoint).length;

      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (secondHalf > firstHalf * 1.2) trend = 'increasing';
      else if (secondHalf < firstHalf * 0.8) trend = 'decreasing';

      return {
        ruleId,
        count: ruleFindings.length,
        severity: ruleFindings[0].severity,
        trend,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return topIssues;
}

/**
 * Generate insights from trend data
 */
function generateInsights(
  timeSeriesData: TrendDataPoint[],
  categoryTrends: CategoryTrend[],
  remediationMetrics: RemediationMetrics,
  topIssues: TrendReport['topIssues'],
): string[] {
  const insights: string[] = [];

  // Overall trend insight
  const totalAtStart = timeSeriesData[0]?.totalFindings || 0;
  const totalAtEnd = timeSeriesData[timeSeriesData.length - 1]?.totalFindings || 0;
  if (totalAtEnd > totalAtStart) {
    insights.push(`Findings increased by ${((totalAtEnd - totalAtStart) / totalAtStart * 100).toFixed(1)}% over the period.`);
  } else if (totalAtEnd < totalAtStart) {
    insights.push(`Findings decreased by ${((totalAtStart - totalAtEnd) / totalAtStart * 100).toFixed(1)}% over the period.`);
  }

  // Category insights
  const increasingCategories = categoryTrends.filter(c => c.trend === 'increasing');
  if (increasingCategories.length > 0) {
    insights.push(`Categories showing increasing trends: ${increasingCategories.map(c => c.category).join(', ')}.`);
  }

  // Remediation insights
  if (remediationMetrics.resolutionRate > 80) {
    insights.push(`Excellent remediation rate of ${remediationMetrics.resolutionRate.toFixed(1)}%.`);
  } else if (remediationMetrics.resolutionRate < 50) {
    insights.push(`Remediation rate of ${remediationMetrics.resolutionRate.toFixed(1)}% needs improvement.`);
  }

  if (remediationMetrics.averageTimeToResolve > 30) {
    insights.push(`Average time to resolve (${remediationMetrics.averageTimeToResolve.toFixed(1)} days) is high. Consider prioritizing critical findings.`);
  }

  // Top issues insight
  const increasingTopIssues = topIssues.filter(i => i.trend === 'increasing');
  if (increasingTopIssues.length > 0) {
    insights.push(`Top issues showing increasing trends: ${increasingTopIssues.map(i => i.ruleId).slice(0, 3).join(', ')}.`);
  }

  return insights;
}

/**
 * Export trend report to JSON
 */
export function exportTrendReportJSON(report: TrendReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Export trend report to CSV
 */
export function exportTrendReportCSV(report: TrendReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push('Date,Total Findings,Open Findings,Resolved Findings,New Findings,Critical,High,Medium,Low,Info');
  
  // Data rows
  for (const dataPoint of report.timeSeriesData) {
    lines.push([
      dataPoint.date.toISOString().split('T')[0],
      dataPoint.totalFindings,
      dataPoint.openFindings,
      dataPoint.resolvedFindings,
      dataPoint.newFindings,
      dataPoint.criticalCount,
      dataPoint.highCount,
      dataPoint.mediumCount,
      dataPoint.lowCount,
      dataPoint.infoCount,
    ].join(','));
  }

  return lines.join('\n');
}

export default {
  generateTrendReport,
  exportTrendReportJSON,
  exportTrendReportCSV,
};
