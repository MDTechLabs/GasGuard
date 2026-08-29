import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum SeverityLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export enum PatternStatus {
  ACTIVE = "active",
  REVIEWED = "reviewed",
  CLEARED = "cleared",
  CONFIRMED_ABUSE = "confirmed_abuse",
}

export enum PatternType {
  ABNORMAL_GAS_USAGE = "abnormal_gas_usage",
  FREQUENCY_ANOMALY = "frequency_anomaly",
  GAS_PRICE_MANIPULATION = "gas_price_manipulation",
  CONTRACT_CALL_ABUSE = "contract_call_abuse",
  BOT_LIKE_BEHAVIOR = "bot_like_behavior",
}

/**
 * Entity to store detected suspicious gas patterns
 */
@Entity("suspicious_gas_patterns")
@Index("idx_sgp_account_chain", ["accountAddress", "chainId"])
@Index("idx_sgp_severity", ["severity"])
@Index("idx_sgp_status", ["status"])
@Index("idx_sgp_created_at", ["createdAt"])
export class SuspiciousGasPattern {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_sgp_account")
  accountAddress: string;

  @Column({ type: "integer" })
  @Index("idx_sgp_chain_id")
  chainId: number;

  @Column({
    type: "enum",
    enum: SeverityLevel,
    default: SeverityLevel.LOW,
  })
  severity: SeverityLevel;

  @Column({
    type: "enum",
    enum: PatternType,
  })
  patternType: PatternType;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "integer", default: 0 })
  flaggedTransactions: number;

  @Column({ type: "decimal", precision: 30, scale: 18, default: 0 })
  abnormalGasTotal: number;

  @Column({ type: "decimal", precision: 30, scale: 18, nullable: true })
  baselineGasUsed: number;

  @Column({ type: "decimal", precision: 10, scale: 4, nullable: true })
  deviationScore: number;

  @Column({ type: "timestamp" })
  firstDetectedAt: Date;

  @Column({ type: "timestamp" })
  lastDetectedAt: Date;

  @Column({
    type: "enum",
    enum: PatternStatus,
    default: PatternStatus.ACTIVE,
  })
  status: PatternStatus;

  @Column({ type: "varchar", length: 100, nullable: true })
  reviewedBy: string;

  @Column({ type: "timestamp", nullable: true })
  reviewedAt: Date;

  @Column({ type: "text", nullable: true })
  reviewNotes: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * Entity to store individual detection logs per transaction
 */
@Entity("gas_pattern_detection_logs")
@Index("idx_gpdl_pattern", ["patternId"])
@Index("idx_gpdl_transaction", ["transactionHash"])
export class GasPatternDetectionLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  patternId: string;

  @Column({ type: "varchar", length: 100 })
  transactionHash: string;

  @Column({ type: "varchar", length: 100 })
  accountAddress: string;

  @Column({ type: "integer" })
  chainId: number;

  @Column({ type: "decimal", precision: 30, scale: 18 })
  gasUsed: number;

  @Column({ type: "decimal", precision: 30, scale: 18 })
  gasPrice: number;

  @Column({ type: "decimal", precision: 10, scale: 4 })
  deviationScore: number;

  @Column({ type: "text", nullable: true })
  detectionReason: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
