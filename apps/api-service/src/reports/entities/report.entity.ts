import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("reports")
export class Report {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_report_type")
  type: string; // 'weekly', 'monthly', 'adhoc'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_report_period")
  period: string; // 'weekly', 'monthly'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_report_merchant_id")
  merchantId: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_report_chain_id")
  chainId?: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_report_status")
  status: string; // 'pending', 'processing', 'completed', 'failed'

  @Column({ type: "varchar", length: 500, nullable: true })
  reportUrl?: string;

  @Column({ type: "jsonb", nullable: true })
  reportData?: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: "timestamp" })
  @Index("idx_report_start_date")
  startDate: Date;

  @Column({ type: "timestamp" })
  @Index("idx_report_end_date")
  endDate: Date;

  @CreateDateColumn()
  @Index("idx_report_created_at")
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "timestamp", nullable: true })
  @Index("idx_report_scheduled_at")
  scheduledAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  @Index("idx_report_sent_at")
  sentAt?: Date;
}
