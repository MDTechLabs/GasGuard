import { ReportStorage } from '../storage';
import { DataRetentionPolicy } from '../policies';
import { mockReportData, mockRetentionConfig } from './fixtures';

describe('Report Data Retention', () => {
  let storage: ReportStorage;
  let policy: DataRetentionPolicy;

  beforeEach(() => {
    storage = new ReportStorage();
    policy = new DataRetentionPolicy(mockRetentionConfig);
  });

  describe('Unit Tests', () => {
    it('should retain reports within retention period', async () => {
      const report = mockReportData({ createdAt: new Date() });
      await storage.save(report);
      const retained = await policy.enforce(storage);
      expect(retained).toContainEqual(report);
    });

    it('should delete reports exceeding retention period', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - mockRetentionConfig.maxAgeDays - 1);
      const report = mockReportData({ createdAt: oldDate });
      await storage.save(report);
      const retained = await policy.enforce(storage);
      expect(retained).not.toContainEqual(report);
    });

    it('should handle empty storage gracefully', async () => {
      const retained = await policy.enforce(storage);
      expect(retained).toEqual([]);
    });

    it('should log retention operations', async () => {
      const spy = jest.spyOn(console, 'log');
      await policy.enforce(storage);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Retention enforcement'));
      spy.mockRestore();
    });
  });

  describe('Boundary Tests', () => {
    it('should handle reports at exact retention boundary', async () => {
      const boundaryDate = new Date();
      boundaryDate.setDate(boundaryDate.getDate() - mockRetentionConfig.maxAgeDays);
      const report = mockReportData({ createdAt: boundaryDate });
      await storage.save(report);
      const retained = await policy.enforce(storage);
      expect(retained).toContainEqual(report);
    });

    it('should handle concurrent retention operations', async () => {
      const reports = Array(100).fill(null).map(() => mockReportData());
      await Promise.all(reports.map(r => storage.save(r)));
      const retained = await policy.enforce(storage);
      expect(retained.length).toBeLessThanOrEqual(reports.length);
    });
  });

  describe('Failure Tests', () => {
    it('should handle storage errors during retention', async () => {
      jest.spyOn(storage, 'list').mockRejectedValue(new Error('Storage failure'));
      await expect(policy.enforce(storage)).rejects.toThrow('Storage failure');
    });

    it('should handle invalid report data', async () => {
      const invalidReport = { ...mockReportData(), createdAt: 'invalid-date' };
      await storage.save(invalidReport as any);
      const retained = await policy.enforce(storage);
      expect(retained).not.toContainEqual(invalidReport);
    });
  });
});