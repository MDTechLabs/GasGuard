import { Command } from 'commander';
import { ScanService } from '../services/scanService';
import { ScanStorage } from '../storage/scanStorage';
import { logger } from '../utils/logger';

export class RerunFailedCommand {
  constructor(private scanService: ScanService, private storage: ScanStorage) {}

  async run(options: { limit?: number; parallel?: number }) {
    const failedScans = await this.storage.getFailedScans(options.limit);
    if (failedScans.length === 0) {
      logger.info('No failed scans to rerun');
      return;
    }

    logger.info(`Rerunning ${failedScans.length} failed scan(s)`);
    await this.scanService.retryFailedScans(failedScans, options.parallel);
  }
}

export function registerRerunCommand(program: Command) {
  program
    .command('rerun-failed')
    .description('Rerun previously failed scans')
    .option('-l, --limit <number>', 'Maximum scans to rerun', parseInt)
    .option('-p, --parallel <number>', 'Parallel execution count', parseInt)
    .action(async (options) => {
      const scanService = new ScanService();
      const storage = new ScanStorage();
      const command = new RerunFailedCommand(scanService, storage);
      await command.run(options);
    });
}