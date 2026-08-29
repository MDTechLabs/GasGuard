import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("gas_price_history")
@Index(["chainId", "timestamp"])
@Index(["timestamp"])
export class GasPriceHistory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 50 })
  chainId: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  chainName: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column({ type: "numeric", precision: 18, scale: 6 })
  baseGasPrice: number; // stroops per instruction

  @Column({ type: "numeric", precision: 8, scale: 4 })
  surgeMultiplier: number; // 1.0 + congestion factor

  @Column({ type: "numeric", precision: 18, scale: 6 })
  effectiveGasPrice: number; // baseGasPrice * surgeMultiplier

  @Column({ type: "numeric", precision: 5, scale: 2 })
  networkLoad: number; // 0-100

  @Column({ type: "numeric", precision: 18, scale: 0 })
  memoryPoolSize: number; // bytes

  @Column({ type: "int" })
  transactionCount: number; // transactions in block

  @Column({ type: "numeric", precision: 8, scale: 2 })
  blockTime: number; // ms

  @Column({ type: "numeric", precision: 5, scale: 2 })
  volatilityIndex: number; // 0-100

  @Column({ type: "numeric", precision: 5, scale: 2 })
  priceConfidence: number; // 0-100
}
