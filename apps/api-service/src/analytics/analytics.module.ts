import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { AnalyticsController } from "./analytics.controller";
import { SuspiciousGasController } from "./controllers/suspicious-gas.controller";
import { DatabaseAnalyticsService } from "../database/services/database-analytics.service";
import { SuspiciousGasDetectionService } from "./services/suspicious-gas-detection.service";
import { SuspiciousGasPatternRepository } from "./repositories/suspicious-gas-pattern.repository";
import { GasBaselineRepository } from "./repositories/gas-baseline.repository";
import {
  SuspiciousGasPattern,
  GasPatternDetectionLog,
} from "./entities/suspicious-gas-pattern.entity";
import { GasBaseline } from "./entities/gas-baseline.entity";
import { Transaction } from "../database/entities/transaction.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SuspiciousGasPattern,
      GasPatternDetectionLog,
      GasBaseline,
      Transaction,
    ]),
    ScheduleModule.forRoot(),
  ],
  controllers: [AnalyticsController, SuspiciousGasController],
  providers: [
    DatabaseAnalyticsService,
    SuspiciousGasDetectionService,
    SuspiciousGasPatternRepository,
    GasBaselineRepository,
  ],
  exports: [
    SuspiciousGasDetectionService,
    SuspiciousGasPatternRepository,
    GasBaselineRepository,
  ],
})
export class AnalyticsModule {}
