import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { GasEstimationController } from "./gas-estimation.controller";
import { NetworkConfigService } from "./config/network-config.service";
import { NetworkMonitorService } from "./services/network-monitor.service";
import { DynamicPricingService } from "./services/dynamic-pricing.service";
import { GasPriceHistoryService } from "./services/gas-price-history.service";
import { GasPriceHistory } from "./entities/gas-price-history.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([GasPriceHistory]),
    ScheduleModule.forRoot(), // For scheduled network metric updates
  ],
  controllers: [GasEstimationController],
  providers: [
    NetworkConfigService,
    NetworkMonitorService,
    DynamicPricingService,
    GasPriceHistoryService,
  ],
  exports: [
    NetworkConfigService,
    NetworkMonitorService,
    DynamicPricingService,
    GasPriceHistoryService,
  ],
})
export class GasEstimationModule {}
