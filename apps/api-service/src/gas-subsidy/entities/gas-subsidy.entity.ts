import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum SubsidyCapType {
  DAILY = "daily",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  LIFETIME = "lifetime",
}

export enum SubsidyStatus {
  ACTIVE = "active",
  SUSPENDED = "suspended",
  EXCEEDED = "exceeded",
  FLAGGED = "flagged",
}

export enum AlertLevel {
  NONE = "none",
  WARNING = "warning",
  CRITICAL = "critical",
  BLOCKED = "blocked",
}

@Entity("gas_subsidy_caps")
export class GasSubsidyCap {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_gsc_wallet_address")
  walletAddress: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  userId: string;

  @Column({ type: "varchar", length: 20 })
  capType: SubsidyCapType;

  @Column({ type: "decimal", precision: 30, scale: 0 })
  maxSubsidyAmount: number; // in minimal units (e.g., Wei for ETH)

  @Column({ type: "decimal", precision: 30, scale: 0, default: 0 })
  currentUsage: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  usagePercentage: number;

  @Column({ type: "varchar", length: 20 })
  status: SubsidyStatus;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 80 })
  warningThreshold: number; // Percentage at which to warn

  @Column({ type: "decimal", precision: 10, scale: 2, default: 100 })
  hardCap: number; // Hard cap percentage

  @Column({ type: "timestamp" })
  periodStart: Date;

  @Column({ type: "timestamp" })
  periodEnd: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: "timestamp", nullable: true })
  lastUsageAt: Date;

  @Column({ type: "varchar", length: 50, nullable: true })
  relayerId: string;

  @Column({ type: "boolean", default: false })
  isRelayerWallet: boolean;
}

@Entity("gas_subsidy_usage_logs")
export class GasSubsidyUsageLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_gsul_wallet_address")
  walletAddress: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  userId: string;

  @Column({ type: "decimal", precision: 30, scale: 0 })
  amount: number;

  @Column({ type: "varchar", length: 100, nullable: true })
  transactionHash: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  chainId: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  description: string;

  @Column({ type: "timestamp" })
  @Index("idx_gsul_timestamp")
  timestamp: Date;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity("gas_subsidy_alerts")
export class GasSubsidyAlert {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  walletAddress: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  userId: string;

  @Column({ type: "varchar", length: 20 })
  alertLevel: AlertLevel;

  @Column({ type: "text" })
  message: string;

  @Column({ type: "decimal", precision: 30, scale: 0 })
  currentUsage: number;

  @Column({ type: "decimal", precision: 30, scale: 0 })
  maxSubsidy: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  usagePercentage: number;

  @Column({ type: "boolean", default: false })
  acknowledged: boolean;

  @Column({ type: "timestamp", nullable: true })
  acknowledgedAt: Date;

  @Column({ type: "varchar", length: 100, nullable: true })
  acknowledgedBy: string;

  @Column({ type: "timestamp" })
  @Index("idx_gsa_timestamp")
  timestamp: Date;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity("suspicious_usage_flags")
export class SuspiciousUsageFlag {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_suf_wallet_address")
  walletAddress: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  userId: string;

  @Column({ type: "varchar", length: 100 })
  flagType: string; // e.g., 'rapid_transactions', 'unusual_pattern', 'threshold_exceeded'

  @Column({ type: "text" })
  description: string;

  @Column({ type: "integer", default: 1 })
  severity: number; // 1-10 scale

  @Column({ type: "boolean", default: true })
  active: boolean;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any>;

  @Column({ type: "timestamp" })
  @Index("idx_suf_timestamp")
  firstDetectedAt: Date;

  @Column({ type: "timestamp" })
  lastDetectedAt: Date;

  @Column({ type: "integer", default: 1 })
  occurrenceCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
