import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  GasSubsidyCap,
  GasSubsidyUsageLog,
  GasSubsidyAlert,
  SuspiciousUsageFlag,
  SubsidyCapType,
  SubsidyStatus,
  AlertLevel,
} from "../entities/gas-subsidy.entity";

export interface SubsidyUsageRecord {
  walletAddress: string;
  userId?: string;
  amount: number;
  transactionHash?: string;
  chainId?: string;
  description?: string;
}

export interface SubsidyCheckResult {
  allowed: boolean;
  remainingSubsidy: number;
  currentUsage: number;
  maxSubsidy: number;
  usagePercentage: number;
  alertLevel: AlertLevel;
  message?: string;
}

export interface CreateCapDto {
  walletAddress: string;
  userId?: string;
  capType: SubsidyCapType;
  maxSubsidyAmount: number;
  warningThreshold?: number;
  hardCap?: number;
  relayerId?: string;
  isRelayerWallet?: boolean;
}

@Injectable()
export class GasSubsidyService {
  private readonly logger = new Logger(GasSubsidyService.name);

  constructor(
    @InjectRepository(GasSubsidyCap)
    private readonly capRepository: Repository<GasSubsidyCap>,
    @InjectRepository(GasSubsidyUsageLog)
    private readonly usageLogRepository: Repository<GasSubsidyUsageLog>,
    @InjectRepository(GasSubsidyAlert)
    private readonly alertRepository: Repository<GasSubsidyAlert>,
    @InjectRepository(SuspiciousUsageFlag)
    private readonly flagRepository: Repository<SuspiciousUsageFlag>,
  ) {}

  /**
   * Create a new subsidy cap for a wallet
   */
  async createCap(dto: CreateCapDto): Promise<GasSubsidyCap> {
    const { periodStart, periodEnd } = this.calculatePeriod(dto.capType);

    const cap = this.capRepository.create({
      walletAddress: dto.walletAddress,
      userId: dto.userId,
      capType: dto.capType,
      maxSubsidyAmount: dto.maxSubsidyAmount,
      currentUsage: 0,
      usagePercentage: 0,
      status: SubsidyStatus.ACTIVE,
      warningThreshold: dto.warningThreshold || 80,
      hardCap: dto.hardCap || 100,
      periodStart,
      periodEnd,
      relayerId: dto.relayerId,
      isRelayerWallet: dto.isRelayerWallet || false,
    });

    return this.capRepository.save(cap);
  }

  /**
   * Get subsidy cap for a wallet
   */
  async getCap(
    walletAddress: string,
    capType?: SubsidyCapType,
  ): Promise<GasSubsidyCap | null> {
    const where: any = { walletAddress };
    if (capType) {
      where.capType = capType;
    }

    return this.capRepository.findOne({
      where,
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Check if usage is allowed and get current subsidy status
   */
  async checkSubsidy(
    walletAddress: string,
    amount: number,
  ): Promise<SubsidyCheckResult> {
    const cap = await this.getCap(walletAddress);

    if (!cap) {
      // No cap defined - allow by default
      return {
        allowed: true,
        remainingSubsidy: 0,
        currentUsage: 0,
        maxSubsidy: 0,
        usagePercentage: 0,
        alertLevel: AlertLevel.NONE,
        message: "No subsidy cap defined",
      };
    }

    // Check if period has expired
    const now = new Date();
    if (now > cap.periodEnd) {
      // Reset for new period
      await this.resetCapPeriod(cap);
      return this.checkSubsidy(walletAddress, amount);
    }

    const newUsage = Number(cap.currentUsage) + amount;
    const usagePercentage = (newUsage / Number(cap.maxSubsidyAmount)) * 100;
    const remainingSubsidy = Number(cap.maxSubsidyAmount) - newUsage;

    // Determine if allowed
    let allowed = true;
    let alertLevel = AlertLevel.NONE;
    let message = "Subsidy available";

    if (usagePercentage >= cap.hardCap) {
      allowed = false;
      alertLevel = AlertLevel.BLOCKED;
      message = "Subsidy cap exceeded";
    } else if (usagePercentage >= cap.warningThreshold) {
      alertLevel = AlertLevel.WARNING;
      message = "Approaching subsidy cap";
    }

    // Check for suspicious patterns
    if (allowed) {
      const suspiciousCheck = await this.checkSuspiciousUsage(walletAddress);
      if (suspiciousCheck.isSuspicious) {
        allowed = suspiciousCheck.blocked || allowed;
        if (suspiciousCheck.severity >= 7) {
          alertLevel = AlertLevel.CRITICAL;
        }
      }
    }

    return {
      allowed,
      remainingSubsidy: Math.max(0, remainingSubsidy),
      currentUsage: newUsage,
      maxSubsidy: Number(cap.maxSubsidyAmount),
      usagePercentage,
      alertLevel,
      message,
    };
  }

  /**
   * Record subsidy usage
   */
  async recordUsage(record: SubsidyUsageRecord): Promise<GasSubsidyUsageLog> {
    // First check subsidy availability
    const checkResult = await this.checkSubsidy(
      record.walletAddress,
      record.amount,
    );

    if (!checkResult.allowed) {
      throw new Error(
        `Subsidy not available for wallet ${record.walletAddress}`,
      );
    }

    // Log the usage
    const usageLog = this.usageLogRepository.create({
      walletAddress: record.walletAddress,
      userId: record.userId,
      amount: record.amount,
      transactionHash: record.transactionHash,
      chainId: record.chainId,
      description: record.description,
      timestamp: new Date(),
    });

    await this.usageLogRepository.save(usageLog);

    // Update cap usage
    await this.updateCapUsage(record.walletAddress, record.amount);

    // Check and create alerts if needed
    await this.checkAndCreateAlerts(record.walletAddress);

    // Check for suspicious usage
    await this.analyzeAndFlagSuspiciousUsage(record);

    return usageLog;
  }

  /**
   * Update cap usage after recording
   */
  private async updateCapUsage(
    walletAddress: string,
    amount: number,
  ): Promise<void> {
    const cap = await this.getCap(walletAddress);
    if (!cap) return;

    cap.currentUsage = Number(cap.currentUsage) + amount;
    cap.usagePercentage =
      (Number(cap.currentUsage) / Number(cap.maxSubsidyAmount)) * 100;
    cap.lastUsageAt = new Date();

    // Update status based on usage
    if (cap.usagePercentage >= cap.hardCap) {
      cap.status = SubsidyStatus.EXCEEDED;
    } else if (cap.usagePercentage >= cap.warningThreshold) {
      cap.status = SubsidyStatus.ACTIVE; // Still active but warned
    }

    await this.capRepository.save(cap);
  }

  /**
   * Reset cap for new period
   */
  private async resetCapPeriod(cap: GasSubsidyCap): Promise<void> {
    const { periodStart, periodEnd } = this.calculatePeriod(cap.capType);

    cap.periodStart = periodStart;
    cap.periodEnd = periodEnd;
    cap.currentUsage = 0;
    cap.usagePercentage = 0;
    cap.status = SubsidyStatus.ACTIVE;

    await this.capRepository.save(cap);
  }

  /**
   * Calculate period dates based on cap type
   */
  private calculatePeriod(capType: SubsidyCapType): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const now = new Date();
    const periodStart = new Date(now);
    const periodEnd = new Date(now);

    switch (capType) {
      case SubsidyCapType.DAILY:
        periodEnd.setDate(periodEnd.getDate() + 1);
        periodEnd.setHours(0, 0, 0, 0);
        break;
      case SubsidyCapType.WEEKLY:
        periodEnd.setDate(periodEnd.getDate() + (7 - periodEnd.getDay()));
        periodEnd.setHours(23, 59, 59, 999);
        break;
      case SubsidyCapType.MONTHLY:
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(0);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      case SubsidyCapType.LIFETIME:
        periodEnd.setFullYear(periodEnd.getFullYear() + 100);
        break;
    }

    return { periodStart, periodEnd };
  }

  /**
   * Check and create alerts for high usage
   */
  private async checkAndCreateAlerts(walletAddress: string): Promise<void> {
    const cap = await this.getCap(walletAddress);
    if (!cap) return;

    // Check if an alert already exists for this period
    const existingAlert = await this.alertRepository.findOne({
      where: {
        walletAddress,
        acknowledged: false,
      },
      order: { timestamp: "DESC" },
    });

    if (existingAlert && existingAlert.usagePercentage >= cap.usagePercentage) {
      return; // Alert already exists at this or higher level
    }

    let alertLevel = AlertLevel.NONE;
    if (cap.usagePercentage >= cap.hardCap) {
      alertLevel = AlertLevel.CRITICAL;
    } else if (cap.usagePercentage >= cap.warningThreshold) {
      alertLevel = AlertLevel.WARNING;
    }

    if (alertLevel !== AlertLevel.NONE) {
      const alert = this.alertRepository.create({
        walletAddress,
        userId: cap.userId,
        alertLevel,
        message: `Subsidy usage at ${cap.usagePercentage.toFixed(2)}%`,
        currentUsage: Number(cap.currentUsage),
        maxSubsidy: Number(cap.maxSubsidyAmount),
        usagePercentage: cap.usagePercentage,
        timestamp: new Date(),
      });

      await this.alertRepository.save(alert);
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(walletAddress?: string): Promise<GasSubsidyAlert[]> {
    const where: any = { acknowledged: false };
    if (walletAddress) {
      where.walletAddress = walletAddress;
    }

    return this.alertRepository.find({
      where,
      order: { timestamp: "DESC" },
    });
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string,
  ): Promise<GasSubsidyAlert> {
    const alert = await this.alertRepository.findOne({
      where: { id: alertId },
    });
    if (!alert) {
      throw new Error("Alert not found");
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;

    return this.alertRepository.save(alert);
  }

  /**
   * Get usage logs for a wallet
   */
  async getUsageLogs(
    walletAddress: string,
    limit: number = 100,
  ): Promise<GasSubsidyUsageLog[]> {
    return this.usageLogRepository.find({
      where: { walletAddress },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  /**
   * Get all caps with their current status
   */
  async getAllCaps(status?: SubsidyStatus): Promise<GasSubsidyCap[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return this.capRepository.find({
      where,
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get real-time subsidy consumption summary
   */
  async getRealtimeSummary(): Promise<{
    totalWallets: number;
    activeWallets: number;
    warnedWallets: number;
    exceededWallets: number;
    flaggedWallets: number;
    totalUsage: number;
    topConsumers: Array<{
      walletAddress: string;
      usage: number;
      percentage: number;
    }>;
  }> {
    const allCaps = await this.capRepository.find();

    const activeWallets = allCaps.filter(
      (c) => c.status === SubsidyStatus.ACTIVE,
    ).length;
    const warnedWallets = allCaps.filter(
      (c) =>
        c.usagePercentage >= c.warningThreshold &&
        c.usagePercentage < c.hardCap,
    ).length;
    const exceededWallets = allCaps.filter(
      (c) => c.status === SubsidyStatus.EXCEEDED,
    ).length;

    // Get flagged wallets count
    const flaggedCount = await this.flagRepository.count({
      where: { active: true },
    });

    // Calculate total usage
    const totalUsage = allCaps.reduce(
      (sum, c) => sum + Number(c.currentUsage),
      0,
    );

    // Get top consumers
    const topConsumers = allCaps
      .sort((a, b) => Number(b.currentUsage) - Number(a.currentUsage))
      .slice(0, 10)
      .map((c) => ({
        walletAddress: c.walletAddress,
        usage: Number(c.currentUsage),
        percentage: c.usagePercentage,
      }));

    return {
      totalWallets: allCaps.length,
      activeWallets,
      warnedWallets,
      exceededWallets,
      flaggedWallets: flaggedCount,
      totalUsage,
      topConsumers,
    };
  }

  /**
   * Check for suspicious usage patterns
   */
  private async checkSuspiciousUsage(walletAddress: string): Promise<{
    isSuspicious: boolean;
    blocked: boolean;
    severity: number;
  }> {
    const recentFlags = await this.flagRepository.find({
      where: { walletAddress, active: true },
      order: { lastDetectedAt: "DESC" },
    });

    if (recentFlags.length === 0) {
      return { isSuspicious: false, blocked: false, severity: 0 };
    }

    const highestSeverity = Math.max(...recentFlags.map((f) => f.severity));
    return {
      isSuspicious: true,
      blocked: highestSeverity >= 8,
      severity: highestSeverity,
    };
  }

  /**
   * Analyze and flag suspicious usage
   */
  private async analyzeAndFlagSuspiciousUsage(
    record: SubsidyUsageRecord,
  ): Promise<void> {
    const recentLogs = await this.usageLogRepository.find({
      where: { walletAddress: record.walletAddress },
      order: { timestamp: "DESC" },
      take: 10,
    });

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentCount = recentLogs.filter(
      (l) => new Date(l.timestamp) > oneHourAgo,
    ).length;

    // Flag if too many transactions in short period
    if (recentCount > 50) {
      await this.flagUsage(
        record.walletAddress,
        "rapid_transactions",
        `Unusually high transaction rate: ${recentCount} transactions in the last hour`,
        8,
      );
    }

    // Flag if transaction amount is unusually high
    if (recentLogs.length > 0) {
      const avgAmount =
        recentLogs.reduce((sum, l) => sum + Number(l.amount), 0) /
        recentLogs.length;
      if (Number(record.amount) > avgAmount * 10) {
        await this.flagUsage(
          record.walletAddress,
          "unusual_amount",
          `Transaction amount ${record.amount} is ${(Number(record.amount) / avgAmount).toFixed(1)}x the average`,
          6,
        );
      }
    }
  }

  /**
   * Flag suspicious usage
   */
  private async flagUsage(
    walletAddress: string,
    flagType: string,
    description: string,
    severity: number,
  ): Promise<void> {
    const existing = await this.flagRepository.findOne({
      where: { walletAddress, flagType, active: true },
    });

    if (existing) {
      existing.lastDetectedAt = new Date();
      existing.occurrenceCount += 1;
      existing.severity = Math.min(10, existing.severity + 1);
      await this.flagRepository.save(existing);
    } else {
      const flag = this.flagRepository.create({
        walletAddress,
        flagType,
        description,
        severity,
        active: true,
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date(),
        occurrenceCount: 1,
      });
      await this.flagRepository.save(flag);
    }
  }

  /**
   * Get active suspicious usage flags
   */
  async getSuspiciousFlags(
    walletAddress?: string,
  ): Promise<SuspiciousUsageFlag[]> {
    const where: any = { active: true };
    if (walletAddress) {
      where.walletAddress = walletAddress;
    }

    return this.flagRepository.find({
      where,
      order: { severity: "DESC", lastDetectedAt: "DESC" },
    });
  }

  /**
   * Clear a suspicious flag
   */
  async clearSuspiciousFlag(flagId: string): Promise<SuspiciousUsageFlag> {
    const flag = await this.flagRepository.findOne({ where: { id: flagId } });
    if (!flag) {
      throw new Error("Flag not found");
    }

    flag.active = false;
    return this.flagRepository.save(flag);
  }
}
