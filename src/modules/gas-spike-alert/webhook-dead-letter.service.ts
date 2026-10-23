import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AlertPayload, WebhookSubscription } from './gas-spike.interface';

/**
 * A webhook delivery that exhausted all retries in WebhookDispatcherService
 * and was parked instead of dropped, so it can be inspected and replayed
 * once the receiving endpoint is fixed (Issue #1243).
 */
export interface DeadLetterEntry {
  id: string;
  subscriptionId: string;
  /** URL at the time of original failure — the live subscription may have changed since. */
  url: string;
  payload: AlertPayload;
  attempts: number;
  lastError: string;
  firstFailedAt: number;
  lastFailedAt: number;
  replayCount: number;
  lastReplayAt?: number;
  lastReplayError?: string;
}

export interface ReplayResult {
  id: string;
  succeeded: boolean;
  error?: string;
}

/**
 * Performs exactly one delivery attempt (sign + send) against the current
 * subscription record. Supplied by WebhookDispatcherService so this service
 * doesn't need to depend back on it — the dispatcher owns HTTP/signing, this
 * service only owns the dead-letter queue and replay bookkeeping.
 */
export type WebhookDeliveryAttempt = (
  subscription: WebhookSubscription,
  payload: AlertPayload,
) => Promise<void>;

/** In-memory dead-letter queue (replace with a durable store/table in production). */
@Injectable()
export class WebhookDeadLetterService {
  private readonly logger = new Logger(WebhookDeadLetterService.name);
  private readonly entries = new Map<string, DeadLetterEntry>();

  /**
   * Record a delivery that exhausted all retries. Called by
   * WebhookDispatcherService.dispatchOne once WEBHOOK_MAX_RETRIES is reached.
   */
  record(params: {
    subscription: WebhookSubscription;
    payload: AlertPayload;
    attempts: number;
    lastError: string;
  }): DeadLetterEntry {
    const id = randomBytes(12).toString('hex');
    const now = Date.now();

    const entry: DeadLetterEntry = {
      id,
      subscriptionId: params.subscription.id,
      url: params.subscription.url,
      payload: params.payload,
      attempts: params.attempts,
      lastError: params.lastError,
      firstFailedAt: now,
      lastFailedAt: now,
      replayCount: 0,
    };

    this.entries.set(id, entry);
    this.logger.error(
      `Webhook ${params.subscription.id} dead-lettered as ${id} after ` +
        `${params.attempts} attempts: ${params.lastError}`,
    );
    return entry;
  }

  /** List dead-lettered deliveries, optionally scoped to one subscription. */
  list(subscriptionId?: string): DeadLetterEntry[] {
    const all = Array.from(this.entries.values());
    return subscriptionId
      ? all.filter((entry) => entry.subscriptionId === subscriptionId)
      : all;
  }

  get(id: string): DeadLetterEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new NotFoundException(`Dead-letter entry ${id} not found`);
    }
    return entry;
  }

  /** Permanently discard a dead-lettered delivery without replaying it. */
  discard(id: string): void {
    if (!this.entries.has(id)) {
      throw new NotFoundException(`Dead-letter entry ${id} not found`);
    }
    this.entries.delete(id);
    this.logger.log(`Dead-letter entry ${id} discarded`);
  }

  /**
   * Replay one entry against the *current* subscription record (url/secret
   * may have been updated since the original failure — only the payload is
   * replayed from the stored snapshot). Removes the entry on success; on
   * failure, updates its replay bookkeeping and leaves it queued.
   */
  async replay(
    id: string,
    subscription: WebhookSubscription,
    attempt: WebhookDeliveryAttempt,
  ): Promise<ReplayResult> {
    const entry = this.get(id);
    entry.replayCount += 1;
    entry.lastReplayAt = Date.now();

    try {
      await attempt(subscription, entry.payload);
      this.entries.delete(id);
      this.logger.log(
        `Dead-letter entry ${id} replayed successfully; removed from queue`,
      );
      return { id, succeeded: true };
    } catch (err) {
      entry.lastReplayError = (err as Error).message;
      this.logger.warn(
        `Dead-letter entry ${id} replay failed: ${entry.lastReplayError}`,
      );
      return { id, succeeded: false, error: entry.lastReplayError };
    }
  }
}
