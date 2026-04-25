import {
  Injectable,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, EventType, OutcomeStatus } from '../entities/audit-log.entity';
import { UserRole } from '../../rbac/enums/role.enum';
import { createHash } from 'crypto';

export interface PauseRecord {
  id: string;
  action: 'pause' | 'unpause';
  triggeredBy: string;
  triggeredByRole: UserRole;
  reason: string;
  autoResumeAt: Date | null;
  timestamp: Date;
}

@Injectable()
export class PauseAuditService {
  private readonly logger = new Logger(PauseAuditService.name);
  private paused = false;
  private pauseLog: PauseRecord[] = [];

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  get isPaused(): boolean {
    return this.paused;
  }

  assertNotPaused(): void {
    if (this.paused) {
      throw new ConflictException('System is currently paused. Critical operations are suspended.');
    }
  }

  async pause(adminId: string, adminRole: UserRole, reason: string, durationMinutes?: number): Promise<PauseRecord> {
    this.requireAdmin(adminRole);

    if (this.paused) {
      throw new ConflictException('System is already paused');
    }

    const autoResumeAt = durationMinutes
      ? new Date(Date.now() + durationMinutes * 60_000)
      : null;

    this.paused = true;

    const record = this.buildRecord('pause', adminId, adminRole, reason, autoResumeAt);
    this.pauseLog.push(record);

    await this.writeAuditLog(record);

    if (autoResumeAt) {
      const delay = autoResumeAt.getTime() - Date.now();
      setTimeout(() => this.autoResume(adminId, reason), delay);
    }

    this.logger.warn(`System PAUSED by ${adminId} — reason: ${reason}`);
    return record;
  }

  async unpause(adminId: string, adminRole: UserRole, reason: string): Promise<PauseRecord> {
    this.requireAdmin(adminRole);

    if (!this.paused) {
      throw new ConflictException('System is not currently paused');
    }

    this.paused = false;

    const record = this.buildRecord('unpause', adminId, adminRole, reason, null);
    this.pauseLog.push(record);

    await this.writeAuditLog(record);

    this.logger.log(`System UNPAUSED by ${adminId} — reason: ${reason}`);
    return record;
  }

  getPauseHistory(): PauseRecord[] {
    return [...this.pauseLog];
  }

  private requireAdmin(role: UserRole): void {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only ADMIN role can control system pause state');
    }
  }

  private buildRecord(
    action: 'pause' | 'unpause',
    triggeredBy: string,
    triggeredByRole: UserRole,
    reason: string,
    autoResumeAt: Date | null,
  ): PauseRecord {
    return {
      id: createHash('sha256')
        .update(`${action}:${triggeredBy}:${Date.now()}`)
        .digest('hex')
        .slice(0, 16),
      action,
      triggeredBy,
      triggeredByRole,
      reason,
      autoResumeAt,
      timestamp: new Date(),
    };
  }

  private async writeAuditLog(record: PauseRecord): Promise<void> {
    const integrity = createHash('sha256')
      .update(JSON.stringify(record))
      .digest('hex');

    const log = this.auditRepo.create({
      eventType: EventType.SYSTEM_ADMIN,
      timestamp: record.timestamp,
      user: record.triggeredBy,
      details: {
        action: record.action,
        reason: record.reason,
        autoResumeAt: record.autoResumeAt,
        pauseRecordId: record.id,
      },
      outcome: OutcomeStatus.SUCCESS,
      integrity,
    });

    await this.auditRepo.save(log);
  }

  private async autoResume(adminId: string, originalReason: string): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    const record = this.buildRecord('unpause', 'system:auto-resume', UserRole.ADMIN, `Auto-resume after timed pause triggered by ${adminId}: ${originalReason}`, null);
    this.pauseLog.push(record);
    await this.writeAuditLog(record);
    this.logger.log('System auto-resumed after timed pause expired');
  }
}
