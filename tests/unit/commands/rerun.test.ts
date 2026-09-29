import { RerunFailedCommand } from '../../../src/commands/rerun';
import { ScanService } from '../../../src/services/scanService';
import { ScanStorage } from '../../../src/storage/scanStorage';

jest.mock('../../../src/services/scanService');
jest.mock('../../../src/storage/scanStorage');

describe('RerunFailedCommand', () => {
  it('should log message when no failed scans exist', async () => {
    const mockStorage = new ScanStorage();
    jest.spyOn(mockStorage, 'getFailedScans').mockResolvedValue([]);
    const mockService = new ScanService();

    const command = new RerunFailedCommand(mockService, mockStorage);
    await command.run({});

    expect(mockService.retryFailedScans).not.toHaveBeenCalled();
  });

  it('should trigger retry for failed scans', async () => {
    const mockScans = [{ id: 'test1', error: 'test', metadata: {}, timestamp: new Date() }];
    const mockStorage = new ScanStorage();
    jest.spyOn(mockStorage, 'getFailedScans').mockResolvedValue(mockScans);
    const mockService = new ScanService();
    jest.spyOn(mockService, 'retryFailedScans');

    const command = new RerunFailedCommand(mockService, mockStorage);
    await command.run({});

    expect(mockService.retryFailedScans).toHaveBeenCalledWith(mockScans, undefined);
  });
});