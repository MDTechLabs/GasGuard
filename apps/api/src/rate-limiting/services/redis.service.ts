/**
 * Redis Service
 *
 * Manages Redis connection with health checks, reconnection logic,
 * and graceful fallback handling for outages.
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from "@nestjs/common";
import Redis from "ioredis";
import { RateLimitConfig } from "../config/rate-limit.config";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject("RATE_LIMIT_CONFIG")
    private readonly config: RateLimitConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Establish Redis connection with event handlers
   */
  private async connect(): Promise<void> {
    try {
      this.client = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db,
        keyPrefix: this.config.redis.keyPrefix,
        enableReadyCheck: this.config.redis.enableReadyCheck,
        maxRetriesPerRequest: this.config.redis.maxRetriesPerRequest,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
      });

      // Set up event handlers
      this.client.on("connect", () => {
        this.logger.log("Redis client connecting...");
      });

      this.client.on("ready", () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.log("Redis client ready and connected");
      });

      this.client.on("error", (error) => {
        this.logger.error("Redis client error:", error.message);
        this.isConnected = false;
      });

      this.client.on("close", () => {
        this.logger.warn("Redis connection closed");
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.client.on("reconnecting", () => {
        this.logger.log("Redis client reconnecting...");
      });

      // Initial connection
      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      this.logger.error("Failed to connect to Redis:", error.message);
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`,
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    this.logger.log(
      `Scheduling Redis reconnect attempt ${this.reconnectAttempts} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.logger.log(
        `Attempting Redis reconnect ${this.reconnectAttempts}...`,
      );
      this.connect();
    }, delay);
  }

  /**
   * Disconnect from Redis gracefully
   */
  private async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      this.logger.log("Redis client disconnected");
    }
  }

  /**
   * Check if Redis is connected and ready
   */
  isReady(): boolean {
    return (
      this.isConnected && this.client !== null && this.client.status === "ready"
    );
  }

  /**
   * Get the Redis client instance
   * Returns null if not connected
   */
  getClient(): Redis | null {
    return this.isReady() ? this.client : null;
  }

  /**
   * Execute a Redis command with fallback handling
   * Returns null if Redis is unavailable and fallback is permissive
   */
  async execute<T>(
    operation: (client: Redis) => Promise<T>,
  ): Promise<T | null> {
    if (!this.isReady()) {
      this.logger.warn("Redis not available, operation skipped");
      return null;
    }

    try {
      return await operation(this.client!);
    } catch (error) {
      this.logger.error("Redis operation failed:", error.message);
      return null;
    }
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck(): Promise<{
    status: string;
    connected: boolean;
    latency?: number;
  }> {
    if (!this.isReady()) {
      return { status: "disconnected", connected: false };
    }

    const start = Date.now();
    try {
      await this.client!.ping();
      const latency = Date.now() - start;
      return { status: "healthy", connected: true, latency };
    } catch (error) {
      return { status: "unhealthy", connected: false };
    }
  }
}
