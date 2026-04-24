import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, EventType, OutcomeStatus } from '../audit/entities/audit-log.entity';
import { UserRole } from '../rbac/enums/role.enum';
import { createHash, randomBytes } from 'crypto';

export type OverrideScope =
  | 'bypass_rate_limit'
  | 'force_transaction'
  | 'unlock_user'
  | 'reset_api_key'
  | 'clear_suspicious_flag';

export interface OverrideToken {
  token: string;
  scope: OverrideScope;
  issuedTo: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface OverrideAuditEntry {
  tokenHash: string;
  adminId: string;
  scope: OverrideScope;
  targetResource: string;
  justification: string;
  outcome: 'issued' | 'used' | 'expired' | 'revoked';
  timestamp: Date;
  integrity: string;
}

const MAX_ACTIVE_TOKENS_PER_ADMIN = 3;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class EmergencyOverrideService {
  private readonly logger = new Logger(EmergencyOverrideService.name);
  private readonly tokens = new Map<string, OverrideToken>();
  private readonly auditTrail: OverrideAuditEntry[] = [];

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async issueOverrideToken(
    adminId: string,
    adminRole: UserRole,
    scope: OverrideScope,
    targetResource: string,
    justification: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    this.requireSuperAdmin(adminRole);
    this.requireJustification(justification);

    const active = [...this.tokens.values()].filter(
      (t) => t.issuedTo === adminId && !t.usedAt && t.expiresAt > new Date(),
    );

    if (active.length >= MAX_ACTIVE_TOKENS_PER_ADMIN) {
      throw new BadRequestException(
        `Admin ${adminId} already has ${MAX_ACTIVE_TOKENS_PER_ADMIN} active override tokens`,
      );
    }

    const raw = randomBytes(32).toString('hex');
    const token = `eo_${raw}`;
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    this.tokens.set(token, { token, scope, issuedTo: adminId, expiresAt, usedAt: null });

    await this.recordAudit(token, adminId, scope, targetResource, justification, 'issued');

    this.logger.warn(`Override token issued: admin=${adminId} scope=${scope} resource=${targetResource}`);
    return { token, expiresAt };
  }

  async consumeOverrideToken(
    token: string,
    expectedScope: OverrideScope,
    targetResource: string,
    justification: string,
  ): Promise<void> {
    const record = this.tokens.get(token);

    if (!record) {
      throw new ForbiddenException('Invalid or unknown override token');
    }

    if (record.usedAt) {
      throw new ForbiddenException('Override token has already been used');
    }

    if (record.expiresAt < new Date()) {
      await this.recordAudit(token, record.issuedTo, record.scope, targetResource, justification, 'expired');
      this.tokens.delete(token);
      throw new ForbiddenException('Override token has expired');
    }

    if (record.scope !== expectedScope) {
      throw new ForbiddenException(
        `Token scope mismatch: expected ${expectedScope}, got ${record.scope}`,
      );
    }

    record.usedAt = new Date();
    await this.recordAudit(token, record.issuedTo, record.scope, targetResource, justification, 'used');

    this.logger.warn(`Override token CONSUMED: admin=${record.issuedTo} scope=${record.scope} resource=${targetResource}`);
  }

  async revokeOverrideToken(token: string, revokedBy: string, revokedByRole: UserRole): Promise<void> {
    this.requireSuperAdmin(revokedByRole);

    const record = this.tokens.get(token);
    if (!record) {
      throw new BadRequestException('Token not found');
    }

    await this.recordAudit(token, revokedBy, record.scope, 'revocation', `Manually revoked by ${revokedBy}`, 'revoked');
    this.tokens.delete(token);
  }

  getAuditTrail(): Readonly<OverrideAuditEntry[]> {
    return this.auditTrail;
  }

  private requireSuperAdmin(role: UserRole): void {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Emergency overrides require ADMIN role');
    }
  }

  private requireJustification(justification: string): void {
    if (!justification || justification.trim().length < 10) {
      throw new BadRequestException('A meaningful justification (min 10 chars) is required for override actions');
    }
  }

  private async recordAudit(
    token: string,
    adminId: string,
    scope: OverrideScope,
    targetResource: string,
    justification: string,
    outcome: OverrideAuditEntry['outcome'],
  ): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const timestamp = new Date();

    const entry: OverrideAuditEntry = {
      tokenHash,
      adminId,
      scope,
      targetResource,
      justification,
      outcome,
      timestamp,
      integrity: '',
    };

    entry.integrity = createHash('sha256').update(JSON.stringify({ ...entry, integrity: undefined })).digest('hex');

    this.auditTrail.push(entry);

    const log = this.auditRepo.create({
      eventType: EventType.SYSTEM_ADMIN,
      timestamp,
      user: adminId,
      details: { tokenHash, scope, targetResource, justification, outcome },
      outcome: OutcomeStatus.SUCCESS,
      integrity: entry.integrity,
    });

    await this.auditRepo.save(log);
  }
}
