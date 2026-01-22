import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

@Module({
  imports: [ConfigModule],
  controllers: [ScanController],
  providers: [ScanService],
  exports: [ScanService],
})
export class ScanModule {}
