import {
  Controller,
  Get,
  Query,
  Param,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
// import type { Response } from 'express';
import { AuditLogService } from "../services/audit-log.service";
import { AuditLogFilterDto, ExportAuditLogsDto } from "../dto/audit-log.dto";

@Controller("audit")
export class AuditController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * Query audit logs with filtering
   * Only accessible by admin users
   * GET /audit/logs?eventType=APIRequest&user=merchant-id&from=2024-01-01&to=2024-12-31
   */
  @Get("logs")
  async getLogs(@Query() filters: AuditLogFilterDto) {
    // In production: Add @UseGuards(AdminGuard) to enforce admin-only access
    try {
      const result = await this.auditLogService.queryLogs(filters);
      return result;
    } catch (error) {
      throw new BadRequestException(`Failed to query logs: ${error.message}`);
    }
  }

  /**
   * Get a specific audit log by ID
   */
  @Get("logs/:id")
  async getLogById(@Param("id") id: string) {
    // In production: Add @UseGuards(AdminGuard) to enforce admin-only access
    const log = await this.auditLogService.getLogById(id);
    if (!log) {
      throw new NotFoundException(`Audit log with id ${id} not found`);
    }
    return log;
  }

  /**
   * Get logs by event type
   */
  @Get("logs/type/:eventType")
  async getLogsByEventType(
    @Param("eventType") eventType: string,
    @Query("limit") limit?: number,
  ) {
    // In production: Add @UseGuards(AdminGuard) to enforce admin-only access
    return this.auditLogService.getLogsByEventType(eventType as any, limit);
  }

  /**
   * Get logs for a specific user
   */
  @Get("logs/user/:userId")
  async getLogsByUser(
    @Param("userId") userId: string,
    @Query("limit") limit?: number,
  ) {
    // In production: Add @UseGuards(AdminGuard) or similar to verify authorization
    return this.auditLogService.getLogsByUser(userId, limit);
  }

  /**
   * Export audit logs in CSV or JSON format
   */
  @Post("logs/export")
  @HttpCode(HttpStatus.OK)
  async exportLogs(@Body() exportDto: ExportAuditLogsDto) {
    // In production: Add @UseGuards(AdminGuard) to enforce admin-only access
    try {
      const data = await this.auditLogService.exportLogs(
        exportDto.format,
        new AuditLogFilterDto(),
      );

      return {
        format: exportDto.format,
        data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new BadRequestException(`Failed to export logs: ${error.message}`);
    }
  }

  /**
   * Get audit statistics
   */
  @Get("stats")
  async getStats() {
    // In production: Add @UseGuards(AdminGuard) to enforce admin-only access
    const stats = {
      message: "Audit statistics endpoint",
      // Implementation can include: event counts by type, user activity, etc.
    };
    return stats;
  }
}
