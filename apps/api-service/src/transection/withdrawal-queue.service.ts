import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type WithdrawalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface WithdrawalRequest {
  id: string;
  userId: string;
  merchantId: string;
  amount: number;
  currency: string;
  priority: WithdrawalPriority;
  status: WithdrawalStatus;
  queuePosition: number;
  retryCount: number;
  failureReason?: string;
  createdAt: Date;
  processedAt?: Date;
}

const PRIORITY_ORDER: Record<WithdrawalPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_RETRIES = 3;

@Injectable()
export class WithdrawalQueueService {
  private readonly logger = new Logger(WithdrawalQueueService.name);
  private readonly queue: WithdrawalRequest[] = [];
  private readonly processed: WithdrawalRequest[] = [];
  private counter = 0;

  enqueue(
    userId: string,
    merchantId: string,
    amount: number,
    currency: string,
    priority: WithdrawalPriority = 'medium',
  ): WithdrawalRequest {
    if (amount <= 0) {
      throw new BadRequestException('Withdrawal amount must be greater than zero');
    }

    const duplicate = this.queue.find(
      (r) =>
        r.userId === userId &&
        r.amount === amount &&
        r.currency === currency &&
        r.status === 'pending',
    );

    if (duplicate) {
      throw new ConflictException(
        `A pending withdrawal of ${amount} ${currency} for user ${userId} already exists`,
      );
    }

    const request: WithdrawalRequest = {
      id: `wq_${++this.counter}_${Date.now()}`,
      userId,
      merchantId,
      amount,
      currency,
      priority,
      status: 'pending',
      queuePosition: 0,
      retryCount: 0,
      createdAt: new Date(),
    };

    this.queue.push(request);
    this.sortQueue();

    this.logger.log(`Enqueued withdrawal ${request.id} for user ${userId} (${priority} priority)`);
    return { ...request };
  }

  async processBatch(batchSize = 10): Promise<WithdrawalRequest[]> {
    const pending = this.queue
      .filter((r) => r.status === 'pending')
      .slice(0, batchSize);

    const results: WithdrawalRequest[] = [];

    for (const request of pending) {
      request.status = 'processing';

      try {
        await this.executeWithdrawal(request);
        request.status = 'completed';
        request.processedAt = new Date();
        this.logger.log(`Withdrawal ${request.id} completed`);
      } catch (err) {
        request.retryCount += 1;
        if (request.retryCount >= MAX_RETRIES) {
          request.status = 'failed';
          request.failureReason = err instanceof Error ? err.message : String(err);
          this.logger.error(`Withdrawal ${request.id} failed after ${MAX_RETRIES} retries`);
        } else {
          request.status = 'pending';
          this.logger.warn(`Withdrawal ${request.id} retrying (attempt ${request.retryCount})`);
        }
      }

      if (request.status === 'completed' || request.status === 'failed') {
        const idx = this.queue.indexOf(request);
        if (idx !== -1) this.queue.splice(idx, 1);
        this.processed.push(request);
      }

      results.push({ ...request });
    }

    this.sortQueue();
    return results;
  }

  getStatus(requestId: string): WithdrawalRequest {
    const active = this.queue.find((r) => r.id === requestId);
    if (active) return { ...active };

    const done = this.processed.find((r) => r.id === requestId);
    if (done) return { ...done };

    throw new NotFoundException(`Withdrawal request ${requestId} not found`);
  }

  getQueueSnapshot(): WithdrawalRequest[] {
    return this.queue.map((r) => ({ ...r }));
  }

  getMetrics() {
    const byStatus = (s: WithdrawalStatus) =>
      [...this.queue, ...this.processed].filter((r) => r.status === s).length;

    return {
      queueLength: this.queue.length,
      pending: byStatus('pending'),
      processing: byStatus('processing'),
      completed: byStatus('completed'),
      failed: byStatus('failed'),
    };
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pd !== 0) return pd;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    this.queue.forEach((r, i) => {
      r.queuePosition = i + 1;
    });
  }

  // Placeholder for real withdrawal execution logic
  private async executeWithdrawal(request: WithdrawalRequest): Promise<void> {
    if (!request.userId || !request.amount) {
      throw new Error('Invalid withdrawal parameters');
    }
  }
}
