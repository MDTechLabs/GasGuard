import { EntityRepository, Repository } from "typeorm";
import { ApiKey, ApiKeyStatus } from "../entities/api-key.entity";

@EntityRepository(ApiKey)
export class ApiKeyRepository extends Repository<ApiKey> {
  /**
   * Create a new API key
   */
  async createApiKey(apiKeyData: Partial<ApiKey>): Promise<ApiKey> {
    const apiKey = this.create(apiKeyData);
    return this.save(apiKey);
  }

  /**
   * Find API key by ID
   */
  async findById(id: string): Promise<ApiKey | null> {
    return this.findOne({ where: { id } });
  }

  /**
   * Find API key by key hash
   */
  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.findOne({ where: { keyHash } });
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
    const query = this.createQueryBuilder("apiKey").where(
      "apiKey.merchantId = :merchantId",
      { merchantId },
    );

    if (status) {
      query.andWhere("apiKey.status = :status", { status });
    }

    query.orderBy("apiKey.createdAt", "DESC").skip(offset).take(limit);

    const data = await query.getMany();
    const total = data.length;
    return { data, total };
  }

  /**
   * Find active API key by hash
   */
  async findActiveByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.findOne({
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
    return this.findOne({
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
    const apiKey = await this.findById(id);
    if (apiKey) {
      apiKey.status = status;
      await this.save(apiKey);
    }
  }

  /**
   * Update API key with partial data
   */
  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<void> {
    const apiKey = await this.findById(id);
    if (apiKey) {
      Object.assign(apiKey, data);
      await this.save(apiKey);
    }
  }

  /**
   * Increment request count and update last used timestamp
   */
  async recordUsage(id: string): Promise<void> {
    const apiKey = await this.findById(id);
    if (apiKey) {
      apiKey.requestCount += 1;
      apiKey.lastUsedAt = new Date();
      await this.save(apiKey);
    }
  }

  /**
   * Find all expired keys that are still ACTIVE
   */
  async findExpiredKeys(): Promise<ApiKey[]> {
    const now = new Date();
    return this.createQueryBuilder("apiKey")
      .where("apiKey.status = :status", { status: ApiKeyStatus.ACTIVE })
      .andWhere("apiKey.expiresAt < :now", { now })
      .getMany();
  }

  /**
   * Find keys expiring within a certain number of days
   */
  async findKeysExpiringWithinDays(days: number): Promise<ApiKey[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const now = new Date();

    return this.createQueryBuilder("apiKey")
      .where("apiKey.status = :status", { status: ApiKeyStatus.ACTIVE })
      .andWhere("apiKey.expiresAt BETWEEN :now AND :futureDate", {
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

    return this.createQueryBuilder("apiKey")
      .where("apiKey.status = :status", { status: ApiKeyStatus.ROTATED })
      .andWhere("apiKey.updatedAt < :cutoffDate", { cutoffDate })
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
    const count = await this.count({
      where: { id, merchantId },
    });
    return count > 0;
  }
}
