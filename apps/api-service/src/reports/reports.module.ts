import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { Report } from "./entities/report.entity";
import { ReportRepository } from "./repositories/report.repository";
import { ReportService } from "./services/report.service";
import { DataAggregationService } from "./services/data-aggregation.service";
import { ReportGenerationService } from "./services/report-generation.service";
import { EmailNotificationService } from "./services/email-notification.service";
import { SchedulingService } from "./services/scheduling.service";
import { ReportController } from "./controllers/report.controller";
import { Transaction } from "../database/entities/transaction.entity";
import { Merchant } from "../database/entities/merchant.entity";
import { Chain } from "../database/entities/chain.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, Transaction, Merchant, Chain]),
    ScheduleModule.forRoot(), // Enable scheduling features
  ],
  controllers: [ReportController],
  providers: [
    ConfigService,
    // Custom repository provider
    {
      provide: "ReportRepository",
      useClass: ReportRepository,
    },
    // Services
    ReportService,
    DataAggregationService,
    ReportGenerationService,
    EmailNotificationService,
    SchedulingService,
  ],
  exports: [ReportService, DataAggregationService],
})
export class ReportsModule {}
