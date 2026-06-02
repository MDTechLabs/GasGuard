import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";

export enum MetricTimeWindow {
  DAILY = "daily",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
}

@Entity("chain_performance_metrics")
export class ChainPerformanceMetric {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_cpm_chain_id")
  chainId: string;

  @Column({ type: "varchar", length: 20 })
  @Index("idx_cpm_time_window")
  timeWindow: MetricTimeWindow;

  @Column({ type: "timestamp" })
  @Index("idx_cpm_recorded_at")
  recordedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  // Transaction metrics
  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  transactionSuccessRate: number;

  @Column({ type: "integer", default: 0 })
  totalTransactions: number;

  @Column({ type: "integer", default: 0 })
  successfulTransactions: number;

  @Column({ type: "integer", default: 0 })
  failedTransactions: number;

  // Gas metrics
  @Column({ type: "decimal", precision: 20, scale: 8, nullable: true })
  averageGasPrice: number;

  @Column({ type: "decimal", precision: 20, scale: 8, nullable: true })
  minGasPrice: number;

  @Column({ type: "decimal", precision: 20, scale: 8, nullable: true })
  maxGasPrice: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  gasPriceVolatility: number;

  @Column({ type: "decimal", precision: 20, scale: 8, nullable: true })
  averageTransactionFee: number;

  // Network performance metrics
  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  averageLatency: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  latencyVolatility: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  networkCongestionScore: number;

  // Reliability score components
  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  stabilityScore: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  costEfficiencyScore: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  overallReliabilityScore: number;
}
