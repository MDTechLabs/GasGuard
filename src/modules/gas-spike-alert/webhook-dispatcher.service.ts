import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import {
  AlertPayload,
  WebhookSubscription,
} from '../interfaces/gas-spike.interface';
import { Severity } from '../enums/severity.enum';
import {
  WEBHOOK_HMAC_ALGO,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_BACKOFF_BASE_MS,
} from '../constants/thresholds';
import { RegisterWebhookDto, UpdateWebhookDto } from '../dto/gas-spike-alert.dto';

/**
 * WebhookDispatcherService
 * ────────────────────────
 * Manages webhook subscriptions and dispatches alert payloads.
 *
 * Security Model
 * ─────────────
 * Every outbound request carries an `X-GasGuard-Signature` header:
 *
 *   X-GasGuard-Signature: sha256=<hex-encoded HMAC>
 *
 * The HMAC is computed over the raw JSON body using the per-subscription
 * secret key.  Recipients verify the signature by computing their own
 * HMAC and comparing via timing-safe equality.
 *
 * Retry Strategy
 * ──────────────
 * On non-2xx responses or network errors the dispatcher retries up to
 * WEBHOOK_MAX_RETRIES times using exponential back-off:
 *
 *   delay = WEBHOOK_BACKOFF_BASE_MS × 2^(attempt - 1)
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  /** In-memory subscription store (replace with DB entity in production) */
  private readonly subscriptions = new Map<string, WebhookSubscription>();

  // ─── Subscription management ─────────────────────────────────────

  register(dto: RegisterWebhookDto): WebhookSubscription {
    const id = randomBytes(12).toString('hex');
    const secret = dto.secret ?? randomBytes(32).toString('hex');

    const subscription: WebhookSubscription = {
      id,
      url: dto.url,
      chainIds: dto.chainIds ?? [],
      minSeverity: dto.minSeverity ?? Severity.WARNING,
      secret,
      createdAt: Date.now(),
      active: true,
    };

    this.subscriptions.set(id, subscription);
    this.logger.log(`Webhook registered: ${id} → ${dto.url}`);
    return subscription;
  }

  update(id: string, dto: UpdateWebhookDto): WebhookSubscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new NotFoundException(`Webhook ${id} not found`);

    const updated: WebhookSubscription = {
      ...sub,
      ...(dto.url !== undefined && { url: dto.url }),
      ...(dto.chainIds !== undefined && { chainIds: dto.chainIds }),
      ...(dto.minSeverity !== undefined && { minSeverity: dto.minSeverity }),
      ...(dto.active !== undefined && { active: dto.active }),
    };

    this.subscriptions.set(id, updated);
    return updated;
  }

  delete(id: string): void {
    if (!this.subscriptions.has(id)) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }
    this.subscriptions.delete(id);
    this.logger.log(`Webhook deleted: ${id}`);
  }

  list(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  findById(id: string): WebhookSubscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new NotFoundException(`Webhook ${id} not found`);
    return sub;
  }

  // ─── Dispatch ─────────────────────────────────────────────────────

  /**
   * Fan-out an alert payload to all matching active subscriptions.
   * Runs dispatches concurrently but captures individual errors so one
   * failing endpoint does not block others.
   */
  async dispatchAll(payload: AlertPayload): Promise<void> {
    const targets = this.getMatchingSubscriptions(payload);

    if (targets.length === 0) {
      this.logger.debug(
        `No subscriptions match alert for chain ${payload.chainId} / ${payload.severity}`,
      );
      return;
    }

    await Promise.allSettled(
      targets.map((sub) => this.dispatchOne(sub, payload)),
    );
  }

  /**
   * Dispatch to a single subscription with retry + back-off.
   */
  async dispatchOne(
    sub: WebhookSubscription,
    payload: AlertPayload,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body, sub.secret);

    const { createSafeAgent } = require('../../security/dns');
    const axios = require('axios');
    const httpAgent = createSafeAgent('http');
    const httpsAgent = createSafeAgent('https');

    for (let attempt = 1; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(sub.url, payload, {
          httpAgent,
          httpsAgent,
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            'X-GasGuard-Signature': `${WEBHOOK_HMAC_ALGO}=${signature}`,
            'X-GasGuard-Subscription-ID': sub.id,
            'X-GasGuard-Timestamp': String(payload.timestamp),
          },
        });

        if (response.status >= 200 && response.status < 300) {
          this.logger.log(
            `Webhook ${sub.id} dispatched successfully (attempt ${attempt})`,
          );
          return;
        }

        this.logger.warn(
          `Webhook ${sub.id} attempt ${attempt} returned HTTP ${response.status}`,
        );
      } catch (err) {
        this.logger.warn(
          `Webhook ${sub.id} attempt ${attempt} network error: ${(err as Error).message}`,
        );
      }

      if (attempt < WEBHOOK_MAX_RETRIES) {
        await this.sleep(WEBHOOK_BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
      }
    }

    this.logger.error(
      `Webhook ${sub.id} failed after ${WEBHOOK_MAX_RETRIES} attempts`,
    );
  }

  // ─── Signature utilities ─────────────────────────────────────────

  sign(body: string, secret: string): string {
    return createHmac(WEBHOOK_HMAC_ALGO, secret).update(body).digest('hex');
  }

  verify(body: string, secret: string, incomingSignature: string): boolean {
    const expected = this.sign(body, secret);
    // Timing-safe comparison
    try {
      return (
        expected.length === incomingSignature.length &&
        createHmac(WEBHOOK_HMAC_ALGO, 'verify')
          .update(expected)
          .digest('hex') ===
          createHmac(WEBHOOK_HMAC_ALGO, 'verify')
            .update(incomingSignature)
            .digest('hex')
      );
    } catch {
      return false;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private getMatchingSubscriptions(payload: AlertPayload): WebhookSubscription[] {
    const severityOrder = [Severity.INFO, Severity.WARNING, Severity.CRITICAL];
    return Array.from(this.subscriptions.values()).filter((sub) => {
      if (!sub.active) return false;

      // Chain filter (empty = all chains)
      if (sub.chainIds.length > 0 && !sub.chainIds.includes(payload.chainId)) {
        return false;
      }

      // Minimum severity filter
      return (
        severityOrder.indexOf(payload.severity) >=
        severityOrder.indexOf(sub.minSeverity)
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
