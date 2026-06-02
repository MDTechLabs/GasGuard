import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLog, EventType, OutcomeStatus } from "../entities";
import {
  AuditLogFilterDto,
  CreateAuditLogDto,
  AuditLogResponseDto,
  AuditLogsPageDto,
} from "../dto/audit-log.dto";
import { AuditEventEmitter, AuditEventPayload } from "./audit-event-emitter";

@Injectable()
export class AuditLogRepository {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async create(createAuditLogDto: CreateAuditLogDto): Promise<AuditLog> {
    const auditLog = this.auditLogRepo.create({
      eventType: createAuditLogDto.eventType as EventType,
      timestamp: new Date(),
      user: createAuditLogDto.user,
      apiKey: createAuditLogDto.apiKey,
      chainId: createAuditLogDto.chainId,
      details: createAuditLogDto.details,
      outcome: createAuditLogDto.outcome as OutcomeStatus,
      endpoint: createAuditLogDto.endpoint,
      httpMethod: createAuditLogDto.httpMethod,
      responseStatus: createAuditLogDto.responseStatus,
      ipAddress: createAuditLogDto.ipAddress,
      errorMessage: createAuditLogDto.errorMessage,
      responseDuration: createAuditLogDto.responseDuration,
      integrity: this.generateIntegrity(createAuditLogDto),
    });

    return this.auditLogRepo.save(auditLog);
  }

  async findById(id: string): Promise<AuditLog | null> {
    return this.auditLogRepo.findOne({ where: { id } });
  }

  async findWithFilters(filters: AuditLogFilterDto): Promise<AuditLogsPageDto> {
    const query = this.auditLogRepo.createQueryBuilder("audit");

    if (filters.eventType) {
      query.andWhere("audit.eventType = :eventType", {
        eventType: filters.eventType,
      });
    }

    if (filters.user) {
      query.andWhere("audit.user = :user", { user: filters.user });
    }

    if (filters.apiKey) {
      query.andWhere("audit.apiKey = :apiKey", { apiKey: filters.apiKey });
    }

    if (filters.chainId) {
      query.andWhere("audit.chainId = :chainId", { chainId: filters.chainId });
    }

    if (filters.outcome) {
      query.andWhere("audit.outcome = :outcome", { outcome: filters.outcome });
    }

    if (filters.from || filters.to) {
      if (filters.from && filters.to) {
        query.andWhere("audit.timestamp BETWEEN :from AND :to", {
          from: new Date(filters.from),
          to: new Date(filters.to),
        });
      } else if (filters.from) {
        query.andWhere("audit.timestamp >= :from", {
          from: new Date(filters.from),
        });
      } else if (filters.to) {
        query.andWhere("audit.timestamp <= :to", { to: new Date(filters.to) });
      }
    }

    const sortBy = filters.sortBy || "timestamp";
    const sortOrder = filters.sortOrder || "DESC";
    query.orderBy(`audit.${sortBy}`, sortOrder as any);

    query.limit(filters.limit || 50);
    query.offset(filters.offset || 0);

    const data = await query.getMany();
    const total = data.length;

    return {
      data: data.map(this.mapToResponse),
      total,
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    };
  }

  async findByEventType(
    eventType: EventType,
    limit = 100,
  ): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { eventType },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async findByUser(user: string, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { user },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async findByApiKey(apiKey: string, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { apiKey },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async findByChain(chainId: number, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { chainId },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async findByDateRange(
    from: Date,
    to: Date,
    limit = 1000,
  ): Promise<AuditLog[]> {
    return this.auditLogRepo
      .createQueryBuilder("audit")
      .where("audit.timestamp >= :from", { from })
      .andWhere("audit.timestamp <= :to", { to })
      .orderBy("audit.timestamp", "DESC")
      .take(limit)
      .getMany();
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.auditLogRepo
      .createQueryBuilder()
      .delete()
      .where("timestamp < :cutoff", { cutoff: cutoffDate })
      .execute();

    return result.affected || 0;
  }

  private generateIntegrity(_dto: CreateAuditLogDto): string {
    // Simple hash placeholder - crypto not available in this build
    return "hash-" + Date.now().toString(36);
  }

  private mapToResponse(auditLog: AuditLog): AuditLogResponseDto {
    return {
      id: auditLog.id,
      eventType: auditLog.eventType,
      timestamp: auditLog.timestamp,
      user: auditLog.user,
      apiKey: auditLog.apiKey,
      chainId: auditLog.chainId,
      details: auditLog.details,
      outcome: auditLog.outcome,
      endpoint: auditLog.endpoint,
      httpMethod: auditLog.httpMethod,
      responseStatus: auditLog.responseStatus,
      ipAddress: auditLog.ipAddress,
      errorMessage: auditLog.errorMessage,
      responseDuration: auditLog.responseDuration,
      createdAt: auditLog.createdAt,
    };
  }
}
