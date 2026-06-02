import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { ChainReliabilityService } from "./services/chain-reliability.service";
import { ScheduledMetricsJob } from "./scheduled-metrics.job";
import { LeaderboardController } from "./controllers/leaderboard.controller";
import { ChainPerformanceMetric } from "./entities/chain-performance-metric.entity";
import { Chain } from "../database/entities/chain.entity";
import { Transaction } from "../database/entities/transaction.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([ChainPerformanceMetric, Chain, Transaction]),
    ScheduleModule.forRoot(),
  ],
  controllers: [LeaderboardController],
  providers: [ChainReliabilityService, ScheduledMetricsJob],
  exports: [ChainReliabilityService],
})
export class ChainReliabilityModule {}
