import { ScanService } from '../../../src/services/scanService';
import { ScanStorage } from '../../../src/storage/scanStorage';

jest.mock('../../../src/storage/scanStorage');

describe('ScanService', () => {
  it('should retry failed scans with exponential backoff', async () => {
    const mockStorage = new ScanStorage();
    const mockScans = [
      { id: 'test1', error: 'test', metadata: {}, timestamp: new Date() }
    ];
    const service = new ScanService();

    jest.spyOn(mockStorage, 'getFailedScans').mockResolvedValue(mockScans);
    jest.spyOn(mockStorage, 'markScanSuccess').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'executeScan').mockRejectedValue(new Error('test'));

    await service.retryFailedScans(mockScans);

    expect(service['executeScan']).toHaveBeenCalledTimes(3);
  });
});