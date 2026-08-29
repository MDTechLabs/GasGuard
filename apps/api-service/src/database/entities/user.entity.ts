import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { UserRole } from "../../rbac/enums/role.enum";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  @Index("idx_user_email", { unique: true })
  email: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  firstName?: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  lastName?: string;

  @Column({ type: "varchar", length: 255 })
  passwordHash: string;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.VIEWER,
  })
  @Index("idx_user_role")
  role: UserRole;

  @Column({ type: "uuid", nullable: true })
  @Index("idx_user_merchant_id")
  merchantId?: string;

  @Column({ type: "boolean", default: true })
  @Index("idx_user_is_active")
  isActive: boolean;

  @Column({ type: "timestamp", nullable: true })
  lastLoginAt?: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  lastLoginIp?: string;

  @Column({ type: "timestamp", nullable: true })
  passwordChangedAt?: Date;

  @Column({ type: "integer", default: 0 })
  failedLoginAttempts: number;

  @Column({ type: "timestamp", nullable: true })
  lockedUntil?: Date;

  @CreateDateColumn()
  @Index("idx_user_created_at")
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: "uuid", nullable: true })
  @Index("idx_user_created_by")
  createdBy?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  /**
   * Get full name of the user
   */
  getFullName(): string {
    if (this.firstName && this.lastName) {
      return `${this.firstName} ${this.lastName}`;
    }
    return this.firstName || this.lastName || this.email;
  }

  isLocked(): boolean {
    if (!this.lockedUntil) {
      return false;
    }
    return new Date() < this.lockedUntil;
  }

  canAuthenticate(): boolean {
    return this.isActive && !this.isLocked();
  }
}
