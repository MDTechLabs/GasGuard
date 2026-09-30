/**
 * Unit tests for Findings Trend Reporter
 */

import {
  Finding,
  generateTrendReport,
  exportTrendReportJSON,
  exportTrendReportCSV,
} from './findings-trend-reporter';

describe('Findings Trend Reporter', () => {
  const mockFindings: Finding[] = [
    {
      id: 'F001',
      ruleId: 'G001',
      severity: 'critical',
      category: 'security',
      filePath: 'src/auth.ts',
      line: 10,
      message: 'SQL injection vulnerability',
      detectedAt: new Date('2026-09-01'),
      status: 'open',
    },
    {
      id: 'F002',
      ruleId: 'G002',
      severity: 'high',
      category: 'performance',
      filePath: 'src/query.ts',
      line: 25,
      message: 'Inefficient query',
      detectedAt: new Date('2026-09-02'),
      resolvedAt: new Date('2026-09-05'),
      status: 'resolved',
    },
    {
      id: 'F003',
      ruleId: 'G001',
      severity: 'critical',
      category: 'security',
      filePath: 'src/api.ts',
      line: 42,
      message: 'SQL injection vulnerability',
      detectedAt: new Date('2026-09-03'),
      status: 'open',
    },
    {
      id: 'F004',
      ruleId: 'G003',
      severity: 'medium',
      category: 'maintainability',
      filePath: 'src/utils.ts',
      line: 15,
      message: 'Code duplication',
      detectedAt: new Date('2026-09-04'),
      resolvedAt: new Date('2026-09-06'),
      status: 'resolved',
    },
  ];

  describe('generateTrendReport', () => {
    it('should generate a complete trend report', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.reportId).toMatch(/^TREND-/);
      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.period.start).toEqual(startDate);
      expect(report.period.end).toEqual(endDate);
      expect(report.summary.totalFindings).toBe(4);
      expect(report.summary.newFindings).toBe(4);
      expect(report.summary.openFindings).toBe(2);
      expect(report.timeSeriesData.length).toBeGreaterThan(0);
      expect(report.categoryTrends.length).toBeGreaterThan(0);
      expect(report.topIssues.length).toBeGreaterThan(0);
      expect(report.insights.length).toBeGreaterThan(0);
    });

    it('should calculate summary correctly', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.summary.openFindings).toBe(2);
      expect(report.summary.resolvedFindings).toBe(2);
    });

    it('should generate time series data', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.timeSeriesData.length).toBeGreaterThan(0);
      expect(report.timeSeriesData[0].date).toBeInstanceOf(Date);
      expect(report.timeSeriesData[0]).toHaveProperty('totalFindings');
      expect(report.timeSeriesData[0]).toHaveProperty('criticalCount');
      expect(report.timeSeriesData[0]).toHaveProperty('highCount');
    });

    it('should analyze category trends', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.categoryTrends.length).toBeGreaterThan(0);
      
      const securityTrend = report.categoryTrends.find(t => t.category === 'security');
      expect(securityTrend).toBeDefined();
      expect(securityTrend?.dataPoints.length).toBeGreaterThan(0);
      expect(['increasing', 'decreasing', 'stable']).toContain(securityTrend?.trend);
    });

    it('should analyze severity trends', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.severityTrends.critical).toBeDefined();
      expect(report.severityTrends.high).toBeDefined();
      expect(report.severityTrends.medium).toBeDefined();
      expect(report.severityTrends.low).toBeDefined();
      expect(['increasing', 'decreasing', 'stable']).toContain(report.severityTrends.critical.trend);
    });

    it('should calculate remediation metrics', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.remediationMetrics.findingsResolvedInPeriod).toBe(2);
      expect(report.remediationMetrics.findingsOpenedInPeriod).toBe(4);
      expect(report.remediationMetrics.resolutionRate).toBeGreaterThan(0);
      expect(report.remediationMetrics.averageTimeToResolve).toBeGreaterThan(0);
    });

    it('should identify top issues', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.topIssues.length).toBeGreaterThan(0);
      
      const topIssue = report.topIssues[0];
      expect(topIssue.ruleId).toBe('G001'); // Most frequent rule
      expect(topIssue.count).toBe(2);
      expect(['increasing', 'decreasing', 'stable']).toContain(topIssue.trend);
    });

    it('should generate insights', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);

      expect(report.insights.length).toBeGreaterThan(0);
      expect(report.insights[0]).toBeTypeOf('string');
    });

    it('should handle empty findings array', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport([], startDate, endDate);

      expect(report.summary.totalFindings).toBe(0);
      expect(report.summary.openFindings).toBe(0);
      expect(report.remediationMetrics.resolutionRate).toBe(0);
    });
  });

  describe('exportTrendReportJSON', () => {
    it('should export report as JSON string', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);
      const json = exportTrendReportJSON(report);

      expect(json).toBeTypeOf('string');
      expect(() => JSON.parse(json)).not.toThrow();
      
      const parsed = JSON.parse(json);
      expect(parsed.reportId).toBe(report.reportId);
      expect(parsed.summary.totalFindings).toBe(report.summary.totalFindings);
    });
  });

  describe('exportTrendReportCSV', () => {
    it('should export report as CSV string', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);
      const csv = exportTrendReportCSV(report);

      expect(csv).toBeTypeOf('string');
      expect(csv).toContain('Date,Total Findings,Open Findings');
      expect(csv.split('\n').length).toBeGreaterThan(1);
    });

    it('should format dates correctly in CSV', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-03');

      const report = generateTrendReport(mockFindings, startDate, endDate);
      const csv = exportTrendReportCSV(report);

      expect(csv).toContain('2026-09-01');
    });

    it('should include all severity columns', () => {
      const startDate = new Date('2026-09-01');
      const endDate = new Date('2026-09-07');

      const report = generateTrendReport(mockFindings, startDate, endDate);
      const csv = exportTrendReportCSV(report);

      expect(csv).toContain('Critical');
      expect(csv).toContain('High');
      expect(csv).toContain('Medium');
      expect(csv).toContain('Low');
      expect(csv).toContain('Info');
    });
  });
});
