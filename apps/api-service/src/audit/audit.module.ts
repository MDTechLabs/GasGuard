import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { AuditLog, ApiKey } from "./entities";
import {
  AuditLogService,
  AuditLogRepository,
  AuditEventEmitter,
  ApiKeyService,
  ApiKeyRepository,
} from "./services";
import { ApiKeyExpirationService } from "./services/api-key-expiration.service";
import { AuditController } from "./controllers/audit.controller";
import { ApiKeyController } from "./controllers/api-key.controller";
import { AuditInterceptor } from "./interceptors";

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, ApiKey]),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuditController, ApiKeyController],
  providers: [
    AuditLogService,
    AuditLogRepository,
    AuditEventEmitter,
    AuditInterceptor,
    ApiKeyService,
    ApiKeyRepository,
    ApiKeyExpirationService,
  ],
  exports: [
    AuditLogService,
    AuditEventEmitter,
    AuditInterceptor,
    ApiKeyService,
    ApiKeyRepository,
  ],
})
export class AuditModule {}
