import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey, ApiKeyStatus } from '../entities/api-key.entity';

@Injectable()
export class ApiKeyRepository {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
  ) {}

  /**
   * Create a new API key
   */
  async create(apiKeyData: Partial<ApiKey>): Promise<ApiKey> {
    const apiKey = this.apiKeyRepo.create(apiKeyData);
    return this.apiKeyRepo.save(apiKey);
  }

  /**
   * Find API key by ID
   */
  async findById(id: string): Promise<ApiKey | null> {
    return this.apiKeyRepo.findOne({ where: { id } });
  }

  /**
   * Find API key by key hash
   */
  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.apiKeyRepo.findOne({ where: { keyHash } });
  }

  /**
   * Find all API keys for a merchant
   */
  async findByMerchantId(
    merchantId: string,
    limit: number = 50,
    offset: number = 0,
    status?: ApiKeyStatus,
  ): Promise<{ data: ApiKey[]; total: number }> {
    const query = this.apiKeyRepo.createQueryBuilder('apiKey')
      .where('apiKey.merchantId = :merchantId', { merchantId });

    if (status) {
      query.andWhere('apiKey.status = :status', { status });
    }

    query.orderBy('apiKey.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    const data = await query.getMany();
    const total = data.length;
    return { data, total };
  }

  /**
   * Find active API key by hash
   */
  async findActiveByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.apiKeyRepo.findOne({
      where: {
        keyHash,
        status: ApiKeyStatus.ACTIVE,
      },
    });
  }

  /**
   * Find API key that is either ACTIVE or ROTATED (for validation during grace period)
   */
  async findValidByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.apiKeyRepo.findOne({
      where: {
        keyHash,
        status: ApiKeyStatus.ACTIVE,
      },
    });
  }

  /**
   * Update API key status
   */
  async updateStatus(id: string, status: ApiKeyStatus): Promise<void> {
    await this.apiKeyRepo
      .createQueryBuilder()
      .update(ApiKey)
      .set({ status })
      .where('id = :id', { id })
      .execute();
  }

  /**
   * Update API key with partial data
   */
  async update(id: string, data: Partial<ApiKey>): Promise<void> {
    await this.apiKeyRepo
      .createQueryBuilder()
      .update(ApiKey)
      .set(data)
      .where('id = :id', { id })
      .execute();
  }

  /**
   * Increment request count and update last used timestamp
   */
  async recordUsage(id: string): Promise<void> {
    const apiKey = await this.findById(id);
    if (apiKey) {
      apiKey.requestCount += 1;
      apiKey.lastUsedAt = new Date();
      await this.apiKeyRepo.save(apiKey);
    }
  }

  /**
   * Find all expired keys that are still ACTIVE
   */
  async findExpiredKeys(): Promise<ApiKey[]> {
    const now = new Date();
    return this.apiKeyRepo.createQueryBuilder('apiKey')
      .where('apiKey.status = :status', { status: ApiKeyStatus.ACTIVE })
      .andWhere('apiKey.expiresAt < :now', { now })
      .getMany();
  }

  /**
   * Find keys expiring within a certain number of days
   */
  async findKeysExpiringWithinDays(days: number): Promise<ApiKey[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const now = new Date();

    return this.apiKeyRepo.createQueryBuilder('apiKey')
      .where('apiKey.status = :status', { status: ApiKeyStatus.ACTIVE })
      .andWhere('apiKey.expiresAt BETWEEN :now AND :futureDate', {
        now,
        futureDate,
      })
      .getMany();
  }

  /**
   * Find keys that have passed their grace period (rotated keys)
   */
  async findKeysPastGracePeriod(gracePeriodHours: number): Promise<ApiKey[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - gracePeriodHours);

    return this.apiKeyRepo.createQueryBuilder('apiKey')
      .where('apiKey.status = :status', { status: ApiKeyStatus.ROTATED })
      .andWhere('apiKey.updatedAt < :cutoffDate', { cutoffDate })
      .getMany();
  }

  /**
   * Soft delete (revoke) an API key
   */
  async revoke(id: string): Promise<void> {
    await this.updateStatus(id, ApiKeyStatus.REVOKED);
  }

  /**
   * Check if merchant owns the API key
   */
  async isOwnedBy(id: string, merchantId: string): Promise<boolean> {
    const count = await this.apiKeyRepo.count({
      where: { id, merchantId },
    });
    return count > 0;
  }
}
