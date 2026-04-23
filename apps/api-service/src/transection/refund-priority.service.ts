import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { UserRole } from '../rbac/enums/role.enum';

export type RefundPriority = 'low' | 'medium' | 'high' | 'critical';
export type RefundStatus = 'queued' | 'processing' | 'completed' | 'cancelled';
export type RefundReason =
  | 'failed_transaction'
  | 'dispute'
  | 'duplicate_charge'
  | 'vip_request'
  | 'sla_breach'
  | 'standard';

export interface RefundRequest {
  id: string;
  userId: string;
  merchantId: string;
  transactionId: string;
  amount: number;
  currency: string;
  reason: RefundReason;
  priority: RefundPriority;
  status: RefundStatus;
  priorityOverriddenBy?: string;
  createdAt: Date;
  processedAt?: Date;
}

const AUTO_PRIORITY_RULES: Record<RefundReason, RefundPriority> = {
  failed_transaction: 'critical',
  dispute: 'high',
  duplicate_charge: 'high',
  sla_breach: 'high',
  vip_request: 'medium',
  standard: 'low',
};

const PRIORITY_WEIGHT: Record<RefundPriority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

@Injectable()
export class RefundPriorityService {
  private readonly logger = new Logger(RefundPriorityService.name);
  private readonly queue: RefundRequest[] = [];
  private readonly auditLog: Array<{
    refundId: string;
    event: string;
    by: string;
    at: Date;
    meta?: Record<string, unknown>;
  }> = [];
  private counter = 0;

  submit(
    userId: string,
    merchantId: string,
    transactionId: string,
    amount: number,
    currency: string,
    reason: RefundReason,
  ): RefundRequest {
    if (amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    if (!transactionId?.trim()) {
      throw new BadRequestException('transactionId is required');
    }

    const priority = AUTO_PRIORITY_RULES[reason];

    const request: RefundRequest = {
      id: `rf_${++this.counter}_${Date.now()}`,
      userId,
      merchantId,
      transactionId,
      amount,
      currency,
      reason,
      priority,
      status: 'queued',
      createdAt: new Date(),
    };

    this.queue.push(request);
    this.sortQueue();

    this.record(request.id, 'submitted', userId, { reason, priority });
    this.logger.log(`Refund ${request.id} queued with priority=${priority} reason=${reason}`);

    return { ...request };
  }

  overridePriority(
    refundId: string,
    newPriority: RefundPriority,
    requestedBy: string,
    requestedByRole: UserRole,
  ): RefundRequest {
    if (requestedByRole !== UserRole.ADMIN && requestedByRole !== UserRole.OPERATOR) {
      throw new ForbiddenException('Only ADMIN or OPERATOR can override refund priority');
    }

    const request = this.findActive(refundId);
    const previous = request.priority;

    request.priority = newPriority;
    request.priorityOverriddenBy = requestedBy;

    this.sortQueue();
    this.record(refundId, 'priority_override', requestedBy, { from: previous, to: newPriority });
    this.logger.warn(`Refund ${refundId} priority changed ${previous} → ${newPriority} by ${requestedBy}`);

    return { ...request };
  }

  processNext(): RefundRequest | null {
    const next = this.queue.find((r) => r.status === 'queued');
    if (!next) return null;

    next.status = 'processing';

    // Simulate synchronous completion; real implementation hooks into payment processor
    next.status = 'completed';
    next.processedAt = new Date();

    const idx = this.queue.indexOf(next);
    if (idx !== -1) this.queue.splice(idx, 1);

    this.record(next.id, 'processed', 'system', { processedAt: next.processedAt });
    this.logger.log(`Refund ${next.id} processed (priority=${next.priority})`);

    return { ...next };
  }

  processBatch(limit = 20): RefundRequest[] {
    const results: RefundRequest[] = [];
    for (let i = 0; i < limit; i++) {
      const r = this.processNext();
      if (!r) break;
      results.push(r);
    }
    return results;
  }

  cancel(refundId: string, cancelledBy: string, role: UserRole): RefundRequest {
    if (role !== UserRole.ADMIN && role !== UserRole.OPERATOR) {
      throw new ForbiddenException('Only ADMIN or OPERATOR can cancel a refund');
    }

    const request = this.findActive(refundId);
    if (request.status !== 'queued') {
      throw new BadRequestException(`Cannot cancel refund in status: ${request.status}`);
    }

    request.status = 'cancelled';
    const idx = this.queue.indexOf(request);
    if (idx !== -1) this.queue.splice(idx, 1);

    this.record(refundId, 'cancelled', cancelledBy);
    return { ...request };
  }

  getQueueSnapshot(): RefundRequest[] {
    return this.queue.map((r) => ({ ...r }));
  }

  getAuditLog() {
    return [...this.auditLog];
  }

  getMetrics() {
    const byPriority = (p: RefundPriority) =>
      this.queue.filter((r) => r.priority === p).length;

    return {
      queueLength: this.queue.length,
      byCritical: byPriority('critical'),
      byHigh: byPriority('high'),
      byMedium: byPriority('medium'),
      byLow: byPriority('low'),
    };
  }

  private findActive(refundId: string): RefundRequest {
    const r = this.queue.find((x) => x.id === refundId);
    if (!r) throw new NotFoundException(`Refund ${refundId} not found in queue`);
    return r;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const pd = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (pd !== 0) return pd;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private record(
    refundId: string,
    event: string,
    by: string,
    meta?: Record<string, unknown>,
  ): void {
    this.auditLog.push({ refundId, event, by, at: new Date(), meta });
  }
}
