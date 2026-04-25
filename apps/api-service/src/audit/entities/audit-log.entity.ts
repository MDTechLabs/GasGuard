import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

export enum EventType {
  API_REQUEST = 'APIRequest',
  API_KEY_CREATED = 'KeyCreated',
  API_KEY_ROTATED = 'KeyRotated',
  API_KEY_REVOKED = 'KeyRevoked',
  GAS_TRANSACTION = 'GasTransaction',
  GAS_SUBMISSION = 'GasSubmission',
  // Admin action events
  CONFIG_UPDATE = 'ConfigUpdate',
  ROLE_CHANGE = 'RoleChange',
  TREASURY_OPERATION = 'TreasuryOperation',
  SYSTEM_ADMIN = 'SystemAdmin',
}

export enum OutcomeStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
  WARNING = 'warning',
}

@Entity('audit_logs')
@Index('idx_audit_event_type', ['eventType'])
@Index('idx_audit_user', ['user'])
@Index('idx_audit_timestamp', ['timestamp'])
@Index('idx_audit_chain_id', ['chainId'])
@Index('idx_audit_composite', ['eventType', 'user', 'timestamp'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: EventType })
  eventType: EventType;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  apiKey: string;

  @Column({ type: 'integer', nullable: true })
  chainId: number;

  @Column({ type: 'jsonb' })
  details: Record<string, any>;

  @Column({ type: 'enum', enum: OutcomeStatus })
  outcome: OutcomeStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpoint: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  httpMethod: string;

  @Column({ type: 'integer', nullable: true })
  responseStatus: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'bigint', nullable: true })
  responseDuration: number; // in milliseconds

  @CreateDateColumn()
  createdAt: Date;

  // Immutability marker - hash for integrity verification
  @Column({ type: 'varchar', length: 64, nullable: true })
  integrity: string;
}
