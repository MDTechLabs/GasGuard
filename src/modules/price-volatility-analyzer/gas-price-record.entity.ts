import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('gas_price_records')
@Index(['chainId', 'timestamp'])
@Index(['chainId', 'interval', 'timestamp'])
export class GasPriceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'chain_id' })
  @Index()
  chainId: number;

  @Column({ name: 'base_fee', type: 'numeric', precision: 30, scale: 0 })
  baseFee: string; // in wei, stored as string to preserve precision

  @Column({ name: 'priority_fee', type: 'numeric', precision: 30, scale: 0 })
  priorityFee: string;

  @Column({ name: 'gas_used', type: 'bigint' })
  gasUsed: string;

  @Column({ name: 'gas_limit', type: 'bigint' })
  gasLimit: string;

  @Column({ name: 'block_number', type: 'bigint' })
  blockNumber: string;

  /**
   * Normalized gas price in Gwei for analytics
   */
  @Column({
    name: 'gas_price_gwei',
    type: 'numeric',
    precision: 20,
    scale: 6,
  })
  gasPriceGwei: number;

  /**
   * Aggregation interval: '1m' | '5m' | '1h' | 'raw'
   */
  @Column({ name: 'interval', length: 10, default: 'raw' })
  interval: string;

  @Column({ name: 'timestamp', type: 'timestamptz' })
  @Index()
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
