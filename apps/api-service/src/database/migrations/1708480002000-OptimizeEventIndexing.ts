import { MigrationInterface, QueryRunner } from "typeorm";

export class OptimizeEventIndexing1708480002000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add more indexes for audit_logs for Issue #106
        await queryRunner.query(`CREATE INDEX "idx_audit_outcome" ON "audit_logs" ("outcome")`);
        await queryRunner.query(`CREATE INDEX "idx_audit_api_key" ON "audit_logs" ("apiKey")`);
        await queryRunner.query(`CREATE INDEX "idx_audit_endpoint" ON "audit_logs" ("endpoint")`);
        
        // Add indexes for transactions too
        await queryRunner.query(`CREATE INDEX "idx_transactions_status" ON "transactions" ("status")`);
        await queryRunner.query(`CREATE INDEX "idx_transactions_type" ON "transactions" ("type")`);
        await queryRunner.query(`CREATE INDEX "idx_transactions_chain_id" ON "transactions" ("chain_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_audit_outcome"`);
        await queryRunner.query(`DROP INDEX "idx_audit_api_key"`);
        await queryRunner.query(`DROP INDEX "idx_audit_endpoint"`);
        await queryRunner.query(`DROP INDEX "idx_transactions_status"`);
        await queryRunner.query(`DROP INDEX "idx_transactions_type"`);
        await queryRunner.query(`DROP INDEX "idx_transactions_chain_id"`);
    }
}
