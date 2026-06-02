import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("transactions")
export class Transaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_transaction_hash")
  transactionHash: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_merchant_id")
  merchantId: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_chain_id")
  chainId: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_contract_address")
  contractAddress: string;

  @Column({ type: "decimal", precision: 30, scale: 18 })
  @Index("idx_gas_used")
  gasUsed: number;

  @Column({ type: "decimal", precision: 30, scale: 18, nullable: true })
  gasPrice?: number;

  @Column({ type: "decimal", precision: 30, scale: 18 })
  transactionFee: number;

  @Column({ type: "varchar", length: 20 })
  @Index("idx_status")
  status: string; // 'success', 'failed', 'pending'

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_transaction_type")
  transactionType: string; // 'deployment', 'function_call', 'transfer'

  @Column({ type: "varchar", length: 100, nullable: true })
  functionName?: string;

  @Column({ type: "jsonb", nullable: true })
  functionParams?: Record<string, any>;

  @Column({ type: "timestamp" })
  @Index("idx_created_at")
  createdAt: Date;

  @CreateDateColumn()
  @Index("idx_created_at_auto")
  createdAtAuto: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_region")
  region?: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  @Index("idx_user_id")
  userId?: string;

  @Column({ type: "integer", default: 0 })
  @Index("idx_retry_count")
  retryCount: number;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_priority")
  priority?: string; // 'low', 'medium', 'high', 'critical'
}
