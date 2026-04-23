import Redis from 'ioredis';
import { redisConfig } from '../../packages/config/redis';

export class CacheService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      keyPrefix: redisConfig.keyPrefix,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  async set(key: string, value: any, ttl: number = redisConfig.ttl): Promise<void> {
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    await this.redis.set(key, data, 'EX', ttl);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  generateKey(repo: string, commit: string): string {
    return `analysis:${repo}:${commit}`;
  }
}
