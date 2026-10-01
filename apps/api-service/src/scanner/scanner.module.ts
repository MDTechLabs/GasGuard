import { Module } from "@nestjs/common";
import { ScannerController } from "./scanner.controller";
import { ScannerService } from "./scanner.service";
import { RulesModule } from "../rules/rules.module";
import { ArchiveValidationModule } from "./validation/archive-validation.module";

@Module({
  imports: [RulesModule, ArchiveValidationModule],
  controllers: [ScannerController],
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
