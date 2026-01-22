import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { ScannerModule } from './scanner/scanner.module';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [HealthModule, ScannerModule, AnalyzerModule, RulesModule],
})
export class AppModule {}
