import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * Entity to store behavioral baselines per account for gas pattern detection
 */
@Entity('gas_baselines')
@Index('idx_gb_account_chain', ['accountAddress', 'chainId'])
@Index('idx_gb_last_updated', ['lastUpdated'])
export class GasBaseline {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  @Index('idx_gb_account')
  accountAddress: string;

  @Column({ type: 'integer' })
  @Index('idx_gb_chain_id')
  chainId: number;

  @Column({ type: 'decimal', precision: 30, scale: 18, default: 0 })
  avgGasUsed: number;

  @Column({ type: 'decimal', precision: 30, scale: 18, default: 0 })
  stdDevGasUsed: number;

  @Column({ type: 'decimal', precision: 30, scale: 18, default: 0 })
  avgGasPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  avgTransactionFrequency: number; // transactions per hour

  @Column({ type: 'simple-array', nullable: true })
  commonTxTypes: string[];

  @Column({ type: 'integer', default: 0 })
  sampleSize: number;

  @Column({ type: 'timestamp' })
  lastUpdated: Date;

  @Column({ type: 'timestamp', nullable: true })
  firstTransactionAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastTransactionAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
