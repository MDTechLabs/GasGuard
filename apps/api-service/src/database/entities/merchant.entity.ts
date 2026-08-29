import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("merchants")
export class Merchant {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100, unique: true })
  @Index("idx_merchant_name")
  name: string;

  @Column({ type: "varchar", length: 100, unique: true })
  @Index("idx_merchant_slug")
  slug: string;

  @Column({ type: "varchar", length: 255 })
  description: string;

  @Column({ type: "varchar", length: 50 })
  @Index("idx_merchant_status")
  status: string; // 'active', 'inactive', 'suspended'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_merchant_plan")
  plan: string; // 'free', 'pro', 'enterprise'

  @Column({ type: "varchar", length: 100 })
  @Index("idx_merchant_tier")
  tier: string; // 'basic', 'standard', 'premium'

  @Column({ type: "varchar", length: 255, nullable: true })
  website?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  @Index("idx_merchant_email")
  email?: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_merchant_country")
  country?: string;

  @Column({ type: "timestamp", nullable: true })
  @Index("idx_merchant_last_active")
  lastActiveAt?: Date;

  @Column({ type: "timestamp" })
  @Index("idx_merchant_created_at")
  createdAt: Date;

  @CreateDateColumn()
  @Index("idx_merchant_created_at_auto")
  createdAtAuto: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "boolean", default: false })
  @Index("idx_merchant_verified")
  isVerified: boolean;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: "varchar", length: 50, nullable: true })
  @Index("idx_merchant_category")
  category?: string;
}
