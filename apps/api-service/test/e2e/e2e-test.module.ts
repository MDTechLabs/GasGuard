import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "../../src/health/health.module";
import { ScannerModule } from "../../src/scanner/scanner.module";
import { AnalyzerModule } from "../../src/analyzer/analyzer.module";
import { RulesModule } from "../../src/rules/rules.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env.test",
    }),
    HealthModule,
    ScannerModule,
    AnalyzerModule,
    RulesModule,
  ],
})
export class E2ETestModule {}
