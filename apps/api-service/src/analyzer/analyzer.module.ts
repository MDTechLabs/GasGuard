import { Module } from '@nestjs/common';
import { AnalyzerController } from './analyzer.controller';
import { AnalyzerService } from './analyzer.service';
import { ScannerModule } from '../scanner/scanner.module';

@Module({
  imports: [ScannerModule],
  controllers: [AnalyzerController],
  providers: [AnalyzerService],
  exports: [AnalyzerService],
})
export class AnalyzerModule {}
