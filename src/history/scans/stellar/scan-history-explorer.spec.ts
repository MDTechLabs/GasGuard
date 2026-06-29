/**
 * Soroban Scan History Explorer Tests
 */

import { SorobanScanHistoryExplorer } from './scan-history-explorer';
import { SorobanScanHistoryManager } from './scan-history-manager';
import { SorobanAnalysisResult } from '../../../diffing/stellar/types';
import * as fs from 'fs';
import * as path from 'path';

describe('SorobanScanHistoryExplorer', () => {
  let explorer: SorobanScanHistoryExplorer;
  let manager: SorobanScanHistoryManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(__dirname, 'temp-test-explorer');
    manager = new SorobanScanHistoryManager({
      storageDirectory: tempDir,
      maxScansPerContract: 10,
    });
    explorer = new SorobanScanHistoryExplorer(manager);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getContractSummary', () => {
    it('should return summary of all contracts', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results);

      const summary = explorer.getContractSummary();

      expect(summary.length).toBe(2);
      expect(summary.find(s => s.contractName === 'ContractA')?.scanCount).toBe(2);
      expect(summary.find(s => s.contractName === 'ContractB')?.scanCount).toBe(1);
    });

    it('should calculate average issues per scan', () => {
      const results1: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule2',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 20,
          message: 'Issue 2',
          severity: 'warning',
          confidence: 0.8,
          category: 'gas',
        },
      ];

      const results2: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results1);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results2);

      const summary = explorer.getContractSummary();
      const contractSummary = summary.find(s => s.contractName === 'ContractA');

      expect(contractSummary?.totalIssues).toBe(3);
      expect(contractSummary?.averageIssuesPerScan).toBe(1.5);
    });
  });

  describe('getTrendAnalysis', () => {
    it('should return trend data for a contract', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);

      const trend = explorer.getTrendAnalysis('ContractA');

      expect(trend.length).toBe(2);
      expect(trend[0].totalIssues).toBe(1);
      expect(trend[0].errorCount).toBe(1);
      expect(trend[0].scanId).toBeDefined();
    });

    it('should limit number of scans returned', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);

      const trend = explorer.getTrendAnalysis('ContractA', { maxScans: 2 });

      expect(trend.length).toBe(2);
    });
  });

  describe('findScansWithIssues', () => {
    beforeEach(() => {
      const results1: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Error issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const results2: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule2',
          contractName: 'ContractB',
          filePath: '/path/b',
          line: 20,
          message: 'Warning issue',
          severity: 'warning',
          confidence: 0.8,
          category: 'gas',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results1);
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results2);
    });

    it('should find scans with minimum severity', () => {
      const scans = explorer.findScansWithIssues({ minSeverity: 'error' });
      expect(scans.length).toBe(1);
      expect(scans[0].contractName).toBe('ContractA');
    });

    it('should find scans by category', () => {
      const scans = explorer.findScansWithIssues({ category: 'gas' });
      expect(scans.length).toBe(1);
      expect(scans[0].contractName).toBe('ContractB');
    });

    it('should find scans by contract name', () => {
      const scans = explorer.findScansWithIssues({ contractName: 'ContractA' });
      expect(scans.length).toBe(1);
      expect(scans[0].contractName).toBe('ContractA');
    });
  });

  describe('getRecentScans', () => {
    it('should return recent scans across all contracts', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results);
      manager.addScan('ContractC', '/path/c', 'Network', 'https://net', results);

      const recent = explorer.getRecentScans(2);

      expect(recent.length).toBe(2);
      expect(recent).not.toHaveProperty('results');
    });

    it('should limit results', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results);

      const recent = explorer.getRecentScans(1);

      expect(recent.length).toBe(1);
    });
  });

  describe('getScansByTag', () => {
    it('should return scans with specific tag', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results, {
        tags: ['production', 'audit'],
      });
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results, {
        tags: ['development'],
      });

      const scans = explorer.getScansByTag('production');

      expect(scans.length).toBe(1);
      expect(scans[0].contractName).toBe('ContractA');
    });
  });

  describe('getComparisonHistory', () => {
    it('should return comparison history for a contract', () => {
      const results1: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const results2: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule2',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 20,
          message: 'Issue 2',
          severity: 'warning',
          confidence: 0.8,
          category: 'gas',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results1);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results2);

      const comparisons = explorer.getComparisonHistory('ContractA');

      expect(comparisons.length).toBe(1);
      expect(comparisons[0].diff.newIssues.length).toBe(1);
    });

    it('should return empty array for contract with fewer than 2 scans', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);

      const comparisons = explorer.getComparisonHistory('ContractA');

      expect(comparisons.length).toBe(0);
    });
  });

  describe('searchByDescription', () => {
    it('should find scans matching description query', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results, {
        description: 'Production audit scan',
      });
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results, {
        description: 'Development scan',
      });

      const scans = explorer.searchByDescription('production');

      expect(scans.length).toBe(1);
      expect(scans[0].contractName).toBe('ContractA');
    });

    it('should find scans matching tag query', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results, {
        tags: ['production', 'audit'],
      });

      const scans = explorer.searchByDescription('audit');

      expect(scans.length).toBe(1);
    });
  });

  describe('ScanExplorerBuilder', () => {
    beforeEach(() => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'ContractA',
          filePath: '/path/a',
          line: 10,
          message: 'Issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network1', 'https://net1', results, {
        tags: ['production'],
      });
      manager.addScan('ContractB', '/path/b', 'Network2', 'https://net2', results, {
        tags: ['development'],
      });
    });

    it('should build and execute query with contract filter', () => {
      const result = explorer
        .explore()
        .byContract('ContractA')
        .execute();

      expect(result.scans.length).toBe(1);
      expect(result.scans[0].contractName).toBe('ContractA');
    });

    it('should build and execute query with network filter', () => {
      const result = explorer
        .explore()
        .byNetwork('Network1')
        .execute();

      expect(result.scans.length).toBe(1);
      expect(result.scans[0].networkPassphrase).toBe('Network1');
    });

    it('should build and execute query with tags filter', () => {
      const result = explorer
        .explore()
        .byTags('production')
        .execute();

      expect(result.scans.length).toBe(1);
      expect(result.scans[0].tags).toContain('production');
    });

    it('should build and execute query with sorting', () => {
      const result = explorer
        .explore()
        .sortBy('contractName', 'asc')
        .execute();

      expect(result.scans[0].contractName).toBe('ContractA');
      expect(result.scans[1].contractName).toBe('ContractB');
    });

    it('should build and execute query with limit', () => {
      const result = explorer
        .explore()
        .limitResults(1)
        .execute();

      expect(result.scans.length).toBe(1);
      expect(result.totalCount).toBe(2);
    });

    it('should build and execute query with results included', () => {
      const result = explorer
        .explore()
        .byContract('ContractA')
        .withResults()
        .execute();

      expect(result.scans.length).toBe(1);
      expect(result.scans[0].results.length).toBeGreaterThan(0);
    });

    it('should convert to array', () => {
      const scans = explorer
        .explore()
        .byContract('ContractA')
        .toArray();

      expect(scans.length).toBe(1);
      expect(scans[0].contractName).toBe('ContractA');
    });

    it('should convert to metadata array', () => {
      const metadata = explorer
        .explore()
        .byContract('ContractA')
        .toMetadataArray();

      expect(metadata.length).toBe(1);
      expect(metadata[0]).not.toHaveProperty('results');
    });
  });

  describe('explore', () => {
    it('should return a new ScanExplorerBuilder', () => {
      const builder = explorer.explore();
      expect(builder).toBeDefined();
      expect(builder).toBeInstanceOf(explorer['constructor'].name === 'SorobanScanHistoryExplorer' ? Object.getPrototypeOf(explorer).constructor : Object);
    });
  });

  describe('getManager', () => {
    it('should return the underlying manager', () => {
      const retrievedManager = explorer.getManager();
      expect(retrievedManager).toBe(manager);
    });
  });
});
