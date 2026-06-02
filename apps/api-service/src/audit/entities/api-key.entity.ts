import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";

export enum ApiKeyStatus {
  ACTIVE = "active",
  ROTATED = "rotated",
  REVOKED = "revoked",
  EXPIRED = "expired",
}

@Entity("api_keys")
@Index("idx_apikey_hash", ["keyHash"])
@Index("idx_apikey_merchant", ["merchantId"])
@Index("idx_apikey_status", ["status"])
@Index("idx_apikey_created", ["createdAt"])
export class ApiKey {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  merchantId: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 255 })
  keyHash: string; // Hash of actual key (never store raw)

  @Column({ type: "enum", enum: ApiKeyStatus, default: ApiKeyStatus.ACTIVE })
  status: ApiKeyStatus;

  @Column({ type: "timestamp", nullable: true })
  lastUsedAt: Date;

  @Column({ type: "integer", default: 0 })
  requestCount: number;

  @Column({ type: "timestamp", nullable: true })
  expiresAt: Date;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "varchar", length: 50, default: "user" })
  role: string; // 'user', 'admin', 'read-only'

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: "timestamp", onUpdate: "CURRENT_TIMESTAMP" })
  updatedAt: Date;

  @Column({ type: "uuid", nullable: true })
  rotatedFromId: string; // Reference to previous key version
}
