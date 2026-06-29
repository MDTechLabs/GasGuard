/**
 * Soroban Scan History Manager Tests
 */

import { SorobanScanHistoryManager } from './scan-history-manager';
import { SorobanAnalysisResult } from '../../../diffing/stellar/types';
import * as fs from 'fs';
import * as path from 'path';

describe('SorobanScanHistoryManager', () => {
  let manager: SorobanScanHistoryManager;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(__dirname, 'temp-test-history');
    manager = new SorobanScanHistoryManager({
      storageDirectory: tempDir,
      maxScansPerContract: 10,
      maxScanAgeMs: 365 * 24 * 60 * 60 * 1000,
    });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('addScan', () => {
    it('should add a new scan record', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const scan = manager.addScan(
        'TestContract',
        '/test/path',
        'Test Network',
        'https://test.network',
        results
      );

      expect(scan).toBeDefined();
      expect(scan.contractName).toBe('TestContract');
      expect(scan.totalIssues).toBe(1);
      expect(scan.severityBreakdown.error).toBe(1);
      expect(scan.scanId).toBeDefined();
    });

    it('should calculate severity breakdown correctly', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Error issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule2',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 20,
          message: 'Warning issue',
          severity: 'warning',
          confidence: 0.8,
          category: 'gas',
        },
        {
          ruleId: 'rule3',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 30,
          message: 'Info issue',
          severity: 'info',
          confidence: 0.7,
          category: 'style',
        },
      ];

      const scan = manager.addScan(
        'TestContract',
        '/test/path',
        'Test Network',
        'https://test.network',
        results
      );

      expect(scan.severityBreakdown.error).toBe(1);
      expect(scan.severityBreakdown.warning).toBe(1);
      expect(scan.severityBreakdown.info).toBe(1);
    });

    it('should calculate category breakdown correctly', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Security issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule2',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 20,
          message: 'Security issue 2',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule3',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 30,
          message: 'Gas issue',
          severity: 'warning',
          confidence: 0.8,
          category: 'gas',
        },
      ];

      const scan = manager.addScan(
        'TestContract',
        '/test/path',
        'Test Network',
        'https://test.network',
        results
      );

      expect(scan.categoryBreakdown.security).toBe(2);
      expect(scan.categoryBreakdown.gas).toBe(1);
    });
  });

  describe('getScan', () => {
    it('should retrieve a scan by ID', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const addedScan = manager.addScan(
        'TestContract',
        '/test/path',
        'Test Network',
        'https://test.network',
        results
      );

      const retrievedScan = manager.getScan(addedScan.scanId);

      expect(retrievedScan).toBeDefined();
      expect(retrievedScan?.scanId).toBe(addedScan.scanId);
    });

    it('should return undefined for non-existent scan', () => {
      const scan = manager.getScan('non-existent-id');
      expect(scan).toBeUndefined();
    });
  });

  describe('getScanMetadata', () => {
    it('should retrieve scan metadata without results', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const addedScan = manager.addScan(
        'TestContract',
        '/test/path',
        'Test Network',
        'https://test.network',
        results
      );

      const metadata = manager.getScanMetadata(addedScan.scanId);

      expect(metadata).toBeDefined();
      expect(metadata?.scanId).toBe(addedScan.scanId);
      expect(metadata).not.toHaveProperty('results');
    });
  });

  describe('queryScans', () => {
    beforeEach(() => {
      // Add multiple test scans
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
          ruleId: 'rule2',
          contractName: 'ContractB',
          filePath: '/path/b',
          line: 20,
          message: 'Issue 2',
          severity: 'warning',
          confidence: 0.8,
          category: 'gas',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network1', 'https://net1', results1);
      manager.addScan('ContractB', '/path/b', 'Network2', 'https://net2', results2);
    });

    it('should return all scans when no filter is provided', () => {
      const result = manager.queryScans();
      expect(result.scans.length).toBe(2);
      expect(result.totalCount).toBe(2);
    });

    it('should filter by contract name', () => {
      const result = manager.queryScans({
        filter: { contractName: 'ContractA' },
      });
      expect(result.scans.length).toBe(1);
      expect(result.scans[0].contractName).toBe('ContractA');
    });

    it('should filter by network passphrase', () => {
      const result = manager.queryScans({
        filter: { networkPassphrase: 'Network1' },
      });
      expect(result.scans.length).toBe(1);
      expect(result.scans[0].networkPassphrase).toBe('Network1');
    });

    it('should sort by timestamp descending', () => {
      const result = manager.queryScans({
        sort: { sortBy: 'timestamp', sortOrder: 'desc' },
      });
      expect(result.scans[0].timestamp).toBeGreaterThanOrEqual(result.scans[1].timestamp);
    });

    it('should limit results', () => {
      const result = manager.queryScans({ limit: 1 });
      expect(result.scans.length).toBe(1);
      expect(result.totalCount).toBe(2);
    });

    it('should apply offset for pagination', () => {
      const result = manager.queryScans({ offset: 1 });
      expect(result.scans.length).toBe(1);
      expect(result.totalCount).toBe(2);
    });
  });

  describe('getScansByContract', () => {
    it('should return all scans for a specific contract', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);
      manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);
      manager.addScan('OtherContract', '/other/path', 'Network', 'https://net', results);

      const scans = manager.getScansByContract('TestContract');
      expect(scans.length).toBe(2);
      expect(scans.every(s => s.contractName === 'TestContract')).toBe(true);
    });
  });

  describe('getLatestScan', () => {
    it('should return the most recent scan for a contract', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);
      // Small delay to ensure different timestamps
      const latest = manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);

      const retrieved = manager.getLatestScan('TestContract');
      expect(retrieved?.scanId).toBe(latest.scanId);
    });

    it('should return undefined for contract with no scans', () => {
      const scan = manager.getLatestScan('NonExistentContract');
      expect(scan).toBeUndefined();
    });
  });

  describe('compareScans', () => {
    it('should compare two scans and return diff', () => {
      const results1: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule2',
          contractName: 'TestContract',
          filePath: '/test/path',
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
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Issue 1',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
        {
          ruleId: 'rule3',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 30,
          message: 'Issue 3',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const scan1 = manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results1);
      const scan2 = manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results2);

      const comparison = manager.compareScans(scan1.scanId, scan2.scanId);

      expect(comparison).toBeDefined();
      expect(comparison?.diff.newIssues.length).toBe(1);
      expect(comparison?.diff.fixedIssues.length).toBe(1);
      expect(comparison?.diff.persistentIssues.length).toBe(1);
    });
  });

  describe('deleteScan', () => {
    it('should delete a scan by ID', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const scan = manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);
      const deleted = manager.deleteScan(scan.scanId);

      expect(deleted).toBe(true);
      expect(manager.getScan(scan.scanId)).toBeUndefined();
    });

    it('should return false for non-existent scan', () => {
      const deleted = manager.deleteScan('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteScansByContract', () => {
    it('should delete all scans for a contract', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);
      manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);
      manager.addScan('OtherContract', '/other/path', 'Network', 'https://net', results);

      const deletedCount = manager.deleteScansByContract('TestContract');

      expect(deletedCount).toBe(2);
      expect(manager.getScansByContract('TestContract').length).toBe(0);
      expect(manager.getScansByContract('OtherContract').length).toBe(1);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractA', '/path/a', 'Network', 'https://net', results);
      manager.addScan('ContractB', '/path/b', 'Network', 'https://net', results);

      const stats = manager.getStatistics();

      expect(stats.totalScans).toBe(3);
      expect(stats.totalContracts).toBe(2);
      expect(stats.totalIssues).toBe(3);
      expect(stats.scansByContract.ContractA).toBe(2);
      expect(stats.scansByContract.ContractB).toBe(1);
    });
  });

  describe('persistence', () => {
    it('should save and load scans from disk', () => {
      const results: SorobanAnalysisResult[] = [
        {
          ruleId: 'rule1',
          contractName: 'TestContract',
          filePath: '/test/path',
          line: 10,
          message: 'Test issue',
          severity: 'error',
          confidence: 0.9,
          category: 'security',
        },
      ];

      const scan = manager.addScan('TestContract', '/test/path', 'Network', 'https://net', results);

      // Create a new manager instance with the same storage directory
      const newManager = new SorobanScanHistoryManager({
        storageDirectory: tempDir,
      });

      const retrievedScan = newManager.getScan(scan.scanId);

      expect(retrievedScan).toBeDefined();
      expect(retrievedScan?.scanId).toBe(scan.scanId);
      expect(retrievedScan?.contractName).toBe('TestContract');
    });
  });
});
