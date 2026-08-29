import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("optimization_suggestions")
export class OptimizationSuggestion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_optimization_merchant_id")
  merchantId: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_optimization_type")
  type: string; // 'ChainSwitch', 'TimingAdjustment', 'BatchOptimization', etc.

  @Column({ type: "varchar", length: 500 })
  description: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  @Index("idx_optimization_category")
  category?: string; // 'gas', 'performance', 'security', etc.

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  estimatedSavingsUSD?: number;

  @Column({ type: "decimal", precision: 15, scale: 2, nullable: true })
  estimatedSavingsGas?: number;

  @Column({ type: "integer", default: 1 }) // 1-5 scale, 5 being highest priority
  priority: number;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>; // Additional data about the suggestion

  @Column({ type: "varchar", length: 50, default: "pending" })
  @Index("idx_optimization_status")
  status: string; // 'pending', 'applied', 'rejected', 'archived'

  @Column({ type: "timestamp", nullable: true })
  appliedAt?: Date;

  @CreateDateColumn()
  @Index("idx_optimization_created_at")
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "timestamp", nullable: true })
  @Index("idx_optimization_expires_at")
  expiresAt?: Date;
}
