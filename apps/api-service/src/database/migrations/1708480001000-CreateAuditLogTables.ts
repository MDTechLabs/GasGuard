// TypeORM Migration - Create Audit Log Tables
// This migration creates the necessary tables for the audit logging system

// Stub interfaces for migration compatibility
interface Column {
  name: string;
  type: string;
  isPrimary?: boolean;
  isNullable?: boolean;
  length?: string;
  enum?: string[];
  default?: string;
}

interface TableIndex {
  columnNames: string[];
  name?: string;
}

interface Table {
  name: string;
  columns: Column[];
  indices?: TableIndex[];
}

interface QueryRunner {
  createTable(table: Table): Promise<void>;
  createIndex(
    tableName: string,
    indexName: string,
    columnNames: string[],
    isUnique?: boolean,
  ): Promise<void>;
  dropTable(tableName: string): Promise<void>;
}

interface MigrationInterface {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
}

export class CreateAuditLogTables1708480001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create audit_logs table
    await queryRunner.createTable({
      name: "audit_logs",
      columns: [
        {
          name: "id",
          type: "uuid",
          isPrimary: true,
          default: "gen_random_uuid()",
        },
        {
          name: "eventType",
          type: "enum",
          enum: [
            "APIRequest",
            "KeyCreated",
            "KeyRotated",
            "KeyRevoked",
            "GasTransaction",
            "GasSubmission",
          ],
        },
        {
          name: "timestamp",
          type: "timestamp",
        },
        {
          name: "user",
          type: "varchar",
          length: "255",
          isNullable: true,
        },
        {
          name: "apiKey",
          type: "varchar",
          length: "255",
          isNullable: true,
        },
        {
          name: "chainId",
          type: "integer",
          isNullable: true,
        },
        {
          name: "details",
          type: "jsonb",
        },
        {
          name: "outcome",
          type: "enum",
          enum: ["success", "failure", "warning"],
        },
        {
          name: "endpoint",
          type: "varchar",
          length: "255",
          isNullable: true,
        },
        {
          name: "httpMethod",
          type: "varchar",
          length: "10",
          isNullable: true,
        },
        {
          name: "responseStatus",
          type: "integer",
          isNullable: true,
        },
        {
          name: "ipAddress",
          type: "varchar",
          length: "255",
          isNullable: true,
        },
        {
          name: "errorMessage",
          type: "text",
          isNullable: true,
        },
        {
          name: "responseDuration",
          type: "bigint",
          isNullable: true,
        },
        {
          name: "integrity",
          type: "varchar",
          length: "64",
          isNullable: true,
        },
        {
          name: "createdAt",
          type: "timestamp",
          default: "CURRENT_TIMESTAMP",
        },
      ],
    } as unknown as Table);

    // Create indexes for efficient queries
    await queryRunner.createIndex("audit_logs", "idx_audit_event_type", [
      "eventType",
    ]);
    await queryRunner.createIndex("audit_logs", "idx_audit_user", ["user"]);
    await queryRunner.createIndex("audit_logs", "idx_audit_timestamp", [
      "timestamp",
    ]);
    await queryRunner.createIndex("audit_logs", "idx_audit_chain_id", [
      "chainId",
    ]);
    await queryRunner.createIndex("audit_logs", "idx_audit_composite", [
      "eventType",
      "user",
      "timestamp",
    ]);

    // Create api_keys table
    await queryRunner.createTable({
      name: "api_keys",
      columns: [
        {
          name: "id",
          type: "uuid",
          isPrimary: true,
          default: "gen_random_uuid()",
        },
        {
          name: "merchantId",
          type: "varchar",
          length: "100",
        },
        {
          name: "name",
          type: "varchar",
          length: "255",
        },
        {
          name: "keyHash",
          type: "varchar",
          length: "255",
        },
        {
          name: "status",
          type: "enum",
          enum: ["active", "rotated", "revoked", "expired"],
          default: "'active'",
        },
        {
          name: "lastUsedAt",
          type: "timestamp",
          isNullable: true,
        },
        {
          name: "requestCount",
          type: "integer",
          default: 0,
        },
        {
          name: "expiresAt",
          type: "timestamp",
          isNullable: true,
        },
        {
          name: "description",
          type: "text",
          isNullable: true,
        },
        {
          name: "role",
          type: "varchar",
          length: "50",
          default: "'user'",
        },
        {
          name: "metadata",
          type: "jsonb",
          isNullable: true,
        },
        {
          name: "rotatedFromId",
          type: "uuid",
          isNullable: true,
        },
        {
          name: "createdAt",
          type: "timestamp",
          default: "CURRENT_TIMESTAMP",
        },
        {
          name: "updatedAt",
          type: "timestamp",
          default: "CURRENT_TIMESTAMP",
          onUpdate: "CURRENT_TIMESTAMP",
        },
      ],
    } as unknown as Table);

    // Create indexes for api_keys
    await queryRunner.createIndex("api_keys", "idx_apikey_hash", ["keyHash"]);
    await queryRunner.createIndex("api_keys", "idx_apikey_merchant", [
      "merchantId",
    ]);
    await queryRunner.createIndex("api_keys", "idx_apikey_status", ["status"]);
    await queryRunner.createIndex("api_keys", "idx_apikey_created", [
      "createdAt",
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("api_keys");
    await queryRunner.dropTable("audit_logs");
  }
}
