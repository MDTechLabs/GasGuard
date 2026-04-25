import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

export interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  merchantId: string;
  transactionsLastMinute: number;
  transactionsLastHour: number;
  limitPerMinute: number;
  limitPerHour: number;
  retryAfterSeconds?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxPerMinute: 10,
  maxPerHour: 100,
};

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly timestamps = new Map<string, number[]>();
  private readonly config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a merchant is within rate limits.
   * Throws 429 if limits are exceeded.
   */
  check(merchantId: string): RateLimitStatus {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;

    const all = this.timestamps.get(merchantId) ?? [];
    // Prune timestamps older than 1 hour
    const recent = all.filter((t) => t > oneHourAgo);
    this.timestamps.set(merchantId, recent);

    const lastMinute = recent.filter((t) => t > oneMinuteAgo).length;
    const lastHour = recent.length;

    const status: RateLimitStatus = {
      allowed: true,
      merchantId,
      transactionsLastMinute: lastMinute,
      transactionsLastHour: lastHour,
      limitPerMinute: this.config.maxPerMinute,
      limitPerHour: this.config.maxPerHour,
    };

    if (lastMinute >= this.config.maxPerMinute) {
      const oldestInWindow = recent.filter((t) => t > oneMinuteAgo)[0];
      status.allowed = false;
      status.retryAfterSeconds = Math.ceil((oldestInWindow + 60_000 - now) / 1000);
      this.logger.warn(
        `Rate limit (per-minute) exceeded for merchant ${merchantId}: ${lastMinute} tx in last 60s`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit exceeded: ${lastMinute}/${this.config.maxPerMinute} transactions in the last minute.`,
          retryAfterSeconds: status.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (lastHour >= this.config.maxPerHour) {
      const oldestInWindow = recent[0];
      status.allowed = false;
      status.retryAfterSeconds = Math.ceil((oldestInWindow + 3_600_000 - now) / 1000);
      this.logger.warn(
        `Rate limit (per-hour) exceeded for merchant ${merchantId}: ${lastHour} tx in last 60min`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit exceeded: ${lastHour}/${this.config.maxPerHour} transactions in the last hour.`,
          retryAfterSeconds: status.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return status;
  }

  /**
   * Record a transaction timestamp for a merchant after it has been saved.
   */
  record(merchantId: string): void {
    const all = this.timestamps.get(merchantId) ?? [];
    all.push(Date.now());
    this.timestamps.set(merchantId, all);
  }

  /**
   * Returns current rate-limit status without enforcing the limit.
   */
  getStatus(merchantId: string): RateLimitStatus {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;

    const all = this.timestamps.get(merchantId) ?? [];
    const recent = all.filter((t) => t > oneHourAgo);

    const lastMinute = recent.filter((t) => t > oneMinuteAgo).length;
    const lastHour = recent.length;

    return {
      allowed: lastMinute < this.config.maxPerMinute && lastHour < this.config.maxPerHour,
      merchantId,
      transactionsLastMinute: lastMinute,
      transactionsLastHour: lastHour,
      limitPerMinute: this.config.maxPerMinute,
      limitPerHour: this.config.maxPerHour,
    };
  }
}
