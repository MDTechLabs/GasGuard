import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Transaction, Merchant, Chain, AnalysisResult, User } from "./entities";
import { ChainPerformanceMetric } from "../chain-reliability/entities/chain-performance-metric.entity";
import {
  ApiPerformanceMetric,
  ApiPerformanceAggregate,
} from "../performance-monitoring/entities/api-performance-metric.entity";
import {
  GasSubsidyCap,
  GasSubsidyUsageLog,
  GasSubsidyAlert,
  SuspiciousUsageFlag,
} from "../gas-subsidy/entities/gas-subsidy.entity";
import { AuditLog, ApiKey } from "../audit/entities";
import {
  SuspiciousGasPattern,
  GasPatternDetectionLog,
} from "../analytics/entities/suspicious-gas-pattern.entity";
import { GasBaseline } from "../analytics/entities/gas-baseline.entity";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get("DATABASE_HOST", "localhost"),
        port: configService.get("DATABASE_PORT", 5432),
        username: configService.get("DATABASE_USERNAME", "postgres"),
        password: configService.get("DATABASE_PASSWORD", "postgres"),
        database: configService.get("DATABASE_NAME", "gasguard"),
        entities: [
          Transaction,
          Merchant,
          Chain,
          AnalysisResult,
          User,
          ChainPerformanceMetric,
          ApiPerformanceMetric,
          ApiPerformanceAggregate,
          GasSubsidyCap,
          GasSubsidyUsageLog,
          GasSubsidyAlert,
          SuspiciousUsageFlag,
          AuditLog,
          ApiKey,
          SuspiciousGasPattern,
          GasPatternDetectionLog,
          GasBaseline,
        ],
        synchronize: configService.get("DATABASE_SYNCHRONIZE", false),
        logging: configService.get("DATABASE_LOGGING", false),
        maxQueryExecutionTime: 1000,
        ssl: configService.get("DATABASE_SYNCHRONIZE", false),
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([
      Transaction,
      Merchant,
      Chain,
      AnalysisResult,
      User,
      ChainPerformanceMetric,
      ApiPerformanceMetric,
      ApiPerformanceAggregate,
      GasSubsidyCap,
      GasSubsidyUsageLog,
      GasSubsidyAlert,
      SuspiciousUsageFlag,
      AuditLog,
      ApiKey,
      SuspiciousGasPattern,
      GasPatternDetectionLog,
      GasBaseline,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
