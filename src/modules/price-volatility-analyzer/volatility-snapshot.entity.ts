import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type VolatilityLevel = 'Low' | 'Moderate' | 'High' | 'Extreme';

@Entity('volatility_snapshots')
@Index(['chainId', 'computedAt'])
export class VolatilitySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'chain_id' })
  @Index()
  chainId: number;

  @Column({
    name: 'current_volatility_index',
    type: 'numeric',
    precision: 8,
    scale: 6,
  })
  currentVolatilityIndex: number;

  @Column({ name: 'volatility_level', length: 20 })
  volatilityLevel: VolatilityLevel;

  @Column({
    name: 'rolling_7d',
    type: 'numeric',
    precision: 8,
    scale: 6,
  })
  rolling7d: number;

  @Column({
    name: 'std_deviation',
    type: 'numeric',
    precision: 20,
    scale: 6,
  })
  stdDeviation: number;

  @Column({ name: 'sma_24h', type: 'numeric', precision: 20, scale: 6 })
  sma24h: number;

  @Column({ name: 'ema_24h', type: 'numeric', precision: 20, scale: 6 })
  ema24h: number;

  @Column({
    name: 'short_long_ratio',
    type: 'numeric',
    precision: 10,
    scale: 6,
  })
  shortLongRatio: number;

  /** Number of data points used for computation */
  @Column({ name: 'sample_size', type: 'int' })
  sampleSize: number;

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
