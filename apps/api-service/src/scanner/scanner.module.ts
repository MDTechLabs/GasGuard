import { Module } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [RulesModule],
  controllers: [ScannerController],
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
