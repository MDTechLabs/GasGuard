/**
 * Integration Tests for Analyzer Coverage Reporting
 * 
 * Tests integration between RuleCoverageAnalyzer and CoverageReporter
 */

import { CoverageReporter } from './coverage-reporter';
import { RuleCoverageAnalyzer } from '../../analysis/coverage';
import * as fs from 'fs';
import * as path from 'path';

describe('Coverage Reporting Integration', () => {
  let analyzer: RuleCoverageAnalyzer;
  let reporter: CoverageReporter;
  let testOutputDir: string;

  beforeEach(() => {
    analyzer = new RuleCoverageAnalyzer();
    reporter = new CoverageReporter();
    testOutputDir = path.join(__dirname, '__integration_test__');
  });

  afterEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe('End-to-End Workflow', () => {
    it('should track coverage and generate report', async () => {
      // Simulate AST analysis
      const ast = {
        type: 'Program',
        id: 'root',
        children: [
          { type: 'Function', id: 'fn1' },
          { type: 'Variable', id: 'var1' },
          { type: 'Expression', id: 'expr1' },
        ],
      };

      // Register and analyze
      analyzer.registerAst(ast);
      analyzer.markAnalyzed('fn1');
      analyzer.markAnalyzed('var1');
      analyzer.reportUncovered('Expression');

      // Get metrics
      const metrics = analyzer.getMetrics();

      // Verify metrics
      expect(metrics.totalNodes).toBeGreaterThan(0);
      expect(metrics.analyzedNodes).toBeGreaterThan(0);
      expect(metrics.uncoveredPatterns).toContain('Expression');

      // Create report
      const reportData = reporter.createReportData(
        'IntegrationTest',
        '1.0.0',
        metrics,
        1,
        3,
        500,
      );

      // Generate report
      const textReport = reporter.generate(reportData, { format: 'text' });

      expect(textReport).toContain('IntegrationTest');
      expect(textReport).toContain('Coverage Summary');
      expect(textReport).toContain('Expression');
    });

    it('should support full workflow with file output', async () => {
      // Create mock analysis scenario
      const ast = {
        type: 'Module',
        id: 'mod1',
        children: Array.from({ length: 10 }, (_, i) => ({
          type: 'Node',
          id: `node${i}`,
        })),
      };

      analyzer.registerAst(ast);

      // Analyze 80% of nodes
      for (let i = 0; i < 8; i++) {
        analyzer.markAnalyzed(`node${i}`);
      }

      analyzer.reportUncovered('Node');

      const metrics = analyzer.getMetrics();
      const reportData = reporter.createReportData(
        'FileOutputTest',
        '2.0.0',
        metrics,
        5,
        10,
        1000,
      );

      // Save in multiple formats
      const htmlPath = path.join(testOutputDir, 'report.html');
      const jsonPath = path.join(testOutputDir, 'report.json');
      const mdPath = path.join(testOutputDir, 'report.md');

      await reporter.saveReport(reportData, htmlPath, { format: 'html' });
      await reporter.saveReport(reportData, jsonPath, { format: 'json' });
      await reporter.saveReport(reportData, mdPath, { format: 'markdown' });

      // Verify files exist
      expect(fs.existsSync(htmlPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(mdPath)).toBe(true);

      // Verify content
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      expect(htmlContent).toContain('<!DOCTYPE html>');
      expect(htmlContent).toContain('FileOutputTest');

      const jsonContent = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(jsonContent);
      expect(parsed.projectName).toBe('FileOutputTest');
    });

    it('should handle CI/CD workflow with threshold checking', async () => {
      // Simulate analysis with good coverage
      const ast = {
        type: 'Program',
        id: 'root',
        children: Array.from({ length: 100 }, (_, i) => ({
          type: 'Statement',
          id: `stmt${i}`,
        })),
      };

      analyzer.registerAst(ast);

      // Analyze 90% of nodes (good coverage)
      for (let i = 0; i < 90; i++) {
        analyzer.markAnalyzed(`stmt${i}`);
      }

      const metrics = analyzer.getMetrics();
      const reportData = reporter.createReportData(
        'CI-CD-Test',
        '1.0.0',
        metrics,
        10,
        10,
        2000,
      );

      // Check threshold
      const threshold = { minCoveragePercent: 85, failOnThreshold: true };
      const meetsThreshold = reporter.checkThreshold(metrics, threshold);

      expect(meetsThreshold).toBe(true);

      // Save report
      const outputPath = path.join(testOutputDir, 'ci-report.json');
      const result = await reporter.saveReport(reportData, outputPath, {
        format: 'json',
        thresholdPercent: 85,
      });

      expect(result.success).toBe(true);
      expect(result.thresholdMet).toBe(true);
      expect(result.coveragePercent).toBeGreaterThanOrEqual(85);
    });

    it('should detect low coverage scenarios', async () => {
      // Simulate analysis with poor coverage
      const ast = {
        type: 'Program',
        id: 'root',
        children: Array.from({ length: 100 }, (_, i) => ({
          type: 'Node',
          id: `node${i}`,
        })),
      };

      analyzer.registerAst(ast);

      // Analyze only 60% of nodes (poor coverage)
      for (let i = 0; i < 60; i++) {
        analyzer.markAnalyzed(`node${i}`);
      }

      // Report multiple uncovered patterns
      for (let i = 0; i < 5; i++) {
        analyzer.reportUncovered(`UncoveredPattern${i}`);
      }

      const metrics = analyzer.getMetrics();

      expect(metrics.coveragePercent).toBeLessThan(80);
      expect(metrics.uncoveredPatterns.length).toBe(5);

      const threshold = { minCoveragePercent: 80, failOnThreshold: true };
      const meetsThreshold = reporter.checkThreshold(metrics, threshold);

      expect(meetsThreshold).toBe(false);
    });
  });

  describe('Reset and Multiple Analysis', () => {
    it('should support multiple analysis runs with reset', () => {
      // First analysis
      const ast1 = {
        type: 'Module1',
        id: 'mod1',
        children: [{ type: 'Fn', id: 'fn1' }],
      };

      analyzer.registerAst(ast1);
      analyzer.markAnalyzed('fn1');

      const metrics1 = analyzer.getMetrics();
      expect(metrics1.totalNodes).toBe(2); // Module1 + Fn

      // Reset
      analyzer.reset();

      // Second analysis
      const ast2 = {
        type: 'Module2',
        id: 'mod2',
        children: [
          { type: 'Fn', id: 'fn2' },
          { type: 'Var', id: 'var2' },
        ],
      };

      analyzer.registerAst(ast2);
      analyzer.markAnalyzed('fn2');

      const metrics2 = analyzer.getMetrics();
      expect(metrics2.totalNodes).toBe(3); // Module2 + Fn + Var
      expect(metrics2.analyzedNodes).toBe(1);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle nested AST structures', () => {
      const complexAst = {
        type: 'Program',
        id: 'root',
        children: [
          {
            type: 'Function',
            id: 'fn1',
            children: [
              {
                type: 'Block',
                id: 'block1',
                children: [
                  { type: 'Statement', id: 'stmt1' },
                  { type: 'Statement', id: 'stmt2' },
                ],
              },
            ],
          },
        ],
      };

      analyzer.registerAst(complexAst);
      analyzer.markAnalyzed('fn1');
      analyzer.markAnalyzed('block1');
      analyzer.markAnalyzed('stmt1');

      const metrics = analyzer.getMetrics();

      // Should count all nested nodes
      expect(metrics.totalNodes).toBe(5); // root, fn1, block1, stmt1, stmt2
      expect(metrics.analyzedNodes).toBe(3); // fn1, block1, stmt1

      const reportData = reporter.createReportData(
        'NestedTest',
        '1.0',
        metrics,
        1,
        1,
        100,
      );

      const report = reporter.generate(reportData);
      expect(report).toContain('NestedTest');
    });

    it('should generate report with rule breakdown', () => {
      // Simulate analysis
      const ast = {
        type: 'Module',
        id: 'mod1',
        children: Array.from({ length: 50 }, (_, i) => ({
          type: 'Node',
          id: `node${i}`,
        })),
      };

      analyzer.registerAst(ast);

      for (let i = 0; i < 45; i++) {
        analyzer.markAnalyzed(`node${i}`);
      }

      const metrics = analyzer.getMetrics();

      // Create report with rule breakdown
      const reportData = {
        projectName: 'RuleBreakdownTest',
        version: '1.0',
        timestamp: new Date(),
        coverage: metrics,
        filesCovered: 5,
        totalFiles: 10,
        analysisTimeMs: 1500,
        rulesCoverage: [
          {
            ruleId: 'R001',
            ruleName: 'Test Rule 1',
            nodesAnalyzed: 25,
            nodeTypes: ['Type1', 'Type2'],
            filesAffected: ['file1.ts', 'file2.ts'],
          },
          {
            ruleId: 'R002',
            ruleName: 'Test Rule 2',
            nodesAnalyzed: 20,
            nodeTypes: ['Type3'],
            filesAffected: ['file3.ts'],
          },
        ],
      };

      const report = reporter.generate(reportData, {
        format: 'text',
        includeRuleBreakdown: true,
      });

      expect(report).toContain('Rule Coverage Breakdown');
      expect(report).toContain('R001');
      expect(report).toContain('Test Rule 1');
      expect(report).toContain('R002');
      expect(report).toContain('Test Rule 2');
    });
  });
});
