import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OptimizationSuggestion } from "./entities/optimization-suggestion.entity";
import { OptimizationEngineService } from "./services/optimization-engine.service";
import { DataAnalysisService } from "./services/data-analysis.service";
import { CostOptimizationController } from "./controllers/cost-optimization.controller";
import { Transaction } from "../database/entities/transaction.entity";
import { Chain } from "../database/entities/chain.entity";
import { Merchant } from "../database/entities/merchant.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OptimizationSuggestion,
      Transaction,
      Chain,
      Merchant,
    ]),
  ],
  controllers: [CostOptimizationController],
  providers: [OptimizationEngineService, DataAnalysisService],
  exports: [OptimizationEngineService, DataAnalysisService],
})
export class OptimizationModule {}
