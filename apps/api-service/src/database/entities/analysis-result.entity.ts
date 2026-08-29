import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("analysis_results")
export class AnalysisResult {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_analysis_merchant_id")
  merchantId: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_analysis_chain_id")
  chainId: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_analysis_contract_address")
  contractAddress: string;

  @Column({ type: "text" })
  sourceCode: string;

  @Column({ type: "varchar", length: 20 })
  @Index("idx_analysis_language")
  language: string; // 'solidity', 'rust', 'vyper'

  @Column({ type: "varchar", length: 20 })
  @Index("idx_analysis_status")
  status: string; // 'completed', 'failed', 'pending'

  @Column({ type: "jsonb" })
  findings: any[]; // Array of rule violations

  @Column({ type: "integer" })
  @Index("idx_analysis_violation_count")
  violationCount: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  @Index("idx_analysis_gas_savings")
  estimatedGasSavings?: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  @Index("idx_analysis_cost_savings")
  estimatedCostSavings?: number;

  @Column({ type: "timestamp" })
  @Index("idx_analysis_created_at")
  createdAt: Date;

  @CreateDateColumn()
  @Index("idx_analysis_created_at_auto")
  createdAtAuto: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "varchar", length: 100, nullable: true })
  @Index("idx_analysis_version")
  analyzerVersion?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_analysis_priority")
  priority?: string;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;
}
