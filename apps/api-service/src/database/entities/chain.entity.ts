import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("chains")
export class Chain {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 50, unique: true })
  @Index("idx_chain_name")
  name: string;

  @Column({ type: "varchar", length: 50, unique: true })
  @Index("idx_chain_id_unique")
  chainId: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_chain_network")
  network: string; // 'mainnet', 'testnet', 'devnet'

  @Column({ type: "varchar", length: 50 })
  @Index("idx_chain_status")
  status: string; // 'active', 'inactive', 'maintenance'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_chain_type")
  type: string; // 'evm', 'soroban', 'cosmos', 'other'

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  @Index("idx_chain_gas_price")
  averageGasPrice?: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  @Index("idx_chain_gas_volatility")
  gasVolatility?: number; // Standard deviation of gas prices

  @Column({ type: "integer", default: 0 })
  @Index("idx_chain_transaction_count")
  transactionCount: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 100 })
  @Index("idx_chain_reliability")
  reliabilityScore: number; // 0-100 score

  @Column({ type: "timestamp" })
  @Index("idx_chain_created_at")
  createdAt: Date;

  @CreateDateColumn()
  @Index("idx_chain_created_at_auto")
  createdAtAuto: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "jsonb", nullable: true })
  config?: Record<string, any>;

  @Column({ type: "varchar", length: 255, nullable: true })
  rpcUrl?: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_chain_currency")
  currency?: string;
}
