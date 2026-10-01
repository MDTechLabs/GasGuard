import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { AnalysisResult } from "../database/entities/analysis-result.entity";
import { User } from "../database/entities/user.entity";
import { AuditModule } from "../audit/audit.module";
import { DataRetentionCleanupService } from "./services/data-retention-cleanup.service";
import { UserDataDeletionService } from "./services/user-data-deletion.service";
import { DataRetentionController } from "./controllers/data-retention.controller";
import { TemporaryDirectoryService } from "./services/temporary-directory.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalysisResult, User]),
    ScheduleModule.forRoot(),
    AuditModule,
  ],
  controllers: [DataRetentionController],
  providers: [
    DataRetentionCleanupService,
    UserDataDeletionService,
    TemporaryDirectoryService,
  ],
  exports: [
    DataRetentionCleanupService,
    UserDataDeletionService,
    TemporaryDirectoryService,
  ],
})
export class DataRetentionModule {}
