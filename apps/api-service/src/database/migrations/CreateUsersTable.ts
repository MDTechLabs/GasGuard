import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from "typeorm";

/**
 * Migration to create users table for RBAC system
 */
export class CreateUsersTable implements MigrationInterface {
  name = "CreateUsersTable";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for user roles
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE user_role_enum AS ENUM ('admin', 'operator', 'viewer');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create users table
    await queryRunner.createTable(
      new Table({
        name: "users",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "email",
            type: "varchar",
            length: "100",
            isNullable: false,
          },
          {
            name: "firstName",
            type: "varchar",
            length: "100",
            isNullable: true,
          },
          {
            name: "lastName",
            type: "varchar",
            length: "100",
            isNullable: true,
          },
          {
            name: "passwordHash",
            type: "varchar",
            length: "255",
            isNullable: false,
          },
          {
            name: "role",
            type: "user_role_enum",
            default: "'viewer'",
            isNullable: false,
          },
          {
            name: "merchantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "isActive",
            type: "boolean",
            default: true,
            isNullable: false,
          },
          {
            name: "lastLoginAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "lastLoginIp",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "passwordChangedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "failedLoginAttempts",
            type: "integer",
            default: 0,
            isNullable: false,
          },
          {
            name: "lockedUntil",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
            isNullable: false,
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
            isNullable: false,
          },
          {
            name: "createdBy",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "idx_user_email",
        columnNames: ["email"],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "idx_user_role",
        columnNames: ["role"],
      }),
    );

    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "idx_user_merchant_id",
        columnNames: ["merchantId"],
      }),
    );

    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "idx_user_is_active",
        columnNames: ["isActive"],
      }),
    );

    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "idx_user_created_at",
        columnNames: ["createdAt"],
      }),
    );

    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "idx_user_created_by",
        columnNames: ["createdBy"],
      }),
    );

    // Create foreign key to merchants table
    await queryRunner.createForeignKey(
      "users",
      new TableForeignKey({
        name: "fk_user_merchant",
        columnNames: ["merchantId"],
        referencedColumnNames: ["id"],
        referencedTableName: "merchants",
        onDelete: "SET NULL",
      }),
    );

    // Create trigger for updatedAt
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updatedAt = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS update_users_updated_at ON users;`,
    );

    // Drop foreign key
    const table = await queryRunner.getTable("users");
    const foreignKey = table?.foreignKeys.find(
      (fk: TableForeignKey) => fk.name === "fk_user_merchant",
    );
    if (foreignKey) {
      await queryRunner.dropForeignKey("users", foreignKey);
    }

    // Drop table
    await queryRunner.dropTable("users");

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS user_role_enum;`);
  }
}
