import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  GasSubsidyCap,
  GasSubsidyUsageLog,
  GasSubsidyAlert,
  SuspiciousUsageFlag,
} from "./entities/gas-subsidy.entity";
import { GasSubsidyService } from "./services/gas-subsidy.service";
import { GasSubsidyController } from "./controllers/gas-subsidy.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GasSubsidyCap,
      GasSubsidyUsageLog,
      GasSubsidyAlert,
      SuspiciousUsageFlag,
    ]),
  ],
  controllers: [GasSubsidyController],
  providers: [GasSubsidyService],
  exports: [GasSubsidyService],
})
export class GasSubsidyModule {}
